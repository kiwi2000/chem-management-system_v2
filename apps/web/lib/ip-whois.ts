import net from "node:net";
import { parseIp, parseIpRule, ruleBounds } from "@chem/shared";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/ip-allow";
import { countryOf } from "@/lib/ip-country";

/**
 * 接続元IPアドレスの持ち主を、JPNIC の WHOIS で調べる（2026-10-02 指示）。
 *
 * - **外から来た日本のアドレスだけ**を調べる（割り当て表で国が日本のもの）。
 *   社内のアドレス（192.168.x.x など）や VPN のアドレスは国が分からないので調べない。
 *   JPNIC は日本のアドレスしか持っていないので、ほかの国も調べない
 * - **ログインを待たせない。**問い合わせは裏で 1 件ずつ行い、結果は表（ip_whois）にためる。
 *   アクセス記録の画面は、ためた結果を出すだけ
 * - **同じ範囲は問い合わせない。**JPNIC はネットワークの範囲ごとに答えるので、範囲で覚える
 * - **待つ時間に上限を付ける。**8 秒で打ち切り、30 分たってからもう一度試す
 * - 問い合わせの間は 1 秒あける（JPNIC に負担をかけないため）
 *
 * 外へ出るのは調べるアドレスだけ。そのアドレスは、もともとインターネット越しに
 * つないできた相手のもの（利用者と相談して決めた。2026-10-02）
 */

export interface WhoisInfo {
  /** JPNIC が返したネットワークアドレス（1.0.16.0/24 など） */
  network: string | null;
  networkName: string | null;
  orgJa: string | null;
  orgEn: string | null;
  /** false なら JPNIC にデータが無かった */
  found: boolean;
}

const HOST = "whois.nic.ad.jp";
const TIMEOUT_MS = 8_000;
const GAP_MS = 1_000;
/** 調べ直すまでの日数。範囲の持ち主はめったに変わらない */
const FRESH_FOUND_MS = 90 * 86400_000;
const FRESH_NONE_MS = 30 * 86400_000;
const RETRY_AFTER_MS = 30 * 60_000;

/** 範囲の端を、桁をそろえた 16 進の文字列にする（文字列の大小 ＝ アドレスの大小） */
export function hexKey(family: 4 | 6, value: bigint): string {
  return value.toString(16).padStart(family === 4 ? 8 : 32, "0");
}

/** 調べる対象か。日本に割り当てられたアドレスだけ */
export const needsWhois = (ip: string | null): ip is string => !!ip && countryOf(ip) === "JP";

/**
 * JPNIC の返事（日本語）を読む。
 * IPv4 は `a. [IPネットワークアドレス]   1.0.16.0/24`、IPv6 は行頭の記号が無い
 * `[IPネットワークアドレス]   240b::/26` の形。上位・下位の情報は読まない。
 * ネットワークアドレスが無ければ「データが無い」として null
 */
export function parseJpnic(text: string): Omit<WhoisInfo, "found"> | null {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("上位情報") || line.startsWith("下位情報")) break;
    const mm = line.match(/^(?:[a-z]\.\s*)?\[([^\]]+)\]\s*(.*)$/);
    if (!mm) continue;
    const label = mm[1]!.trim();
    if (!fields.has(label)) fields.set(label, mm[2]!.trim());
  }
  const network = fields.get("IPネットワークアドレス") || null;
  if (!network) return null;
  return {
    network,
    networkName: fields.get("ネットワーク名") || null,
    orgJa: fields.get("組織名") || null,
    orgEn: fields.get("Organization") || null,
  };
}

/** JPNIC に 1 件問い合わせる。返事は ISO-2022-JP */
function queryJpnic(ip: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(43, HOST);
    const chunks: Buffer[] = [];
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
    socket.on("connect", () => socket.write(`${ip}\r\n`));
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("end", () => resolve(new TextDecoder("iso-2022-jp").decode(Buffer.concat(chunks))));
    socket.on("error", reject);
  });
}

export interface WhoisLookup {
  info: WhoisInfo;
  /** 調べ直す時期を過ぎている */
  stale: boolean;
}

/** ためてある結果を引く。範囲が重なるときは、いちばん狭い範囲のものを採る */
export async function whoisFor(ips: readonly string[]): Promise<Map<string, WhoisLookup>> {
  const out = new Map<string, WhoisLookup>();
  const keys = [...new Set(ips)]
    .map((ip) => ({ ip, parsed: parseIp(ip) }))
    .filter((k): k is { ip: string; parsed: NonNullable<ReturnType<typeof parseIp>> } => !!k.parsed)
    .map((k) => ({
      ip: k.ip,
      family: k.parsed.family,
      hex: hexKey(k.parsed.family, k.parsed.value),
    }));
  if (keys.length === 0) return out;
  const rows = await prisma.ipWhois.findMany({
    where: {
      OR: keys.map((k) => ({
        family: k.family,
        rangeStart: { lte: k.hex },
        rangeEnd: { gte: k.hex },
      })),
    },
  });
  const now = Date.now();
  for (const k of keys) {
    const hits = rows
      .filter((r) => r.family === k.family && r.rangeStart <= k.hex && r.rangeEnd >= k.hex)
      .sort((a, b) =>
        a.rangeStart !== b.rangeStart
          ? a.rangeStart < b.rangeStart
            ? 1
            : -1
          : a.rangeEnd < b.rangeEnd
            ? -1
            : 1,
      );
    const r = hits[0];
    if (!r) continue;
    const age = now - r.fetchedAt.getTime();
    out.set(k.ip, {
      info: {
        network: r.network,
        networkName: r.networkName,
        orgJa: r.orgJa,
        orgEn: r.orgEn,
        found: r.found,
      },
      stale: age > (r.found ? FRESH_FOUND_MS : FRESH_NONE_MS),
    });
  }
  return out;
}

// ── 裏で 1 件ずつ問い合わせる ─────────────────────────
// 覚えておくのは動いているあいだだけ。止まれば、次に画面を開いたときにまた並べ直す
const queued = new Set<string>();
const failedUntil = new Map<string, number>();
let chain: Promise<void> = Promise.resolve();

/**
 * 調べる必要があるものを裏の列に並べる。待たない（すぐ戻る）。
 * 日本以外・社内・すでに並んでいる・失敗して間もないものは並べない
 */
export function requestWhois(ips: readonly (string | null)[]): void {
  // 古い記録には「相手, 中継」の並びのまま入っているものがある。先頭が相手
  for (const ip of new Set(ips.map(clientIp))) {
    if (!needsWhois(ip) || queued.has(ip)) continue;
    const until = failedUntil.get(ip);
    if (until && until > Date.now()) continue;
    queued.add(ip);
    chain = chain
      .then(() => lookupAndStore(ip).then(() => undefined))
      .catch(() => undefined)
      .finally(() => queued.delete(ip));
  }
}

/**
 * 1 件を調べてためる。裏の列からと、既にある記録をまとめて埋めるスクリプト
 * （scripts/backfill-ip-whois.ts）から呼ぶ。どちらも 1 件ずつ順に呼ぶこと
 */
export async function lookupAndStore(
  ip: string,
): Promise<"cached" | "found" | "none" | "failed" | "skipped"> {
  // 並んでいるあいだに、同じ範囲の別のアドレスで答えが入っていれば問い合わせない
  const cached = (await whoisFor([ip])).get(ip);
  if (cached && !cached.stale) return "cached";
  const parsed = parseIp(ip);
  if (!parsed) return "skipped";

  let text: string;
  try {
    text = await queryJpnic(ip);
  } catch {
    failedUntil.set(ip, Date.now() + RETRY_AFTER_MS);
    return "failed";
  }
  const info = parseJpnic(text);
  const rule = info?.network ? parseIpRule(info.network) : null;
  const family = parsed.family;
  let start = hexKey(family, parsed.value);
  let end = start;
  if (rule && rule.family === family) {
    const b = ruleBounds(rule);
    start = hexKey(family, b.start);
    end = hexKey(family, b.end);
  }
  await prisma.$transaction([
    prisma.ipWhois.deleteMany({ where: { family, rangeStart: start, rangeEnd: end } }),
    prisma.ipWhois.create({
      data: {
        family,
        rangeStart: start,
        rangeEnd: end,
        network: info?.network ?? null,
        networkName: info?.networkName ?? null,
        orgJa: info?.orgJa ?? null,
        orgEn: info?.orgEn ?? null,
        found: info !== null,
        fetchedAt: new Date(),
      },
    }),
  ]);
  failedUntil.delete(ip);
  await new Promise((r) => setTimeout(r, GAP_MS));
  return info ? "found" : "none";
}
