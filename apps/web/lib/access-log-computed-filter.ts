import { matchesFilter, type ColumnFilter } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/ip-allow";
import { countryOf } from "@/lib/ip-country";
import { whoisFor } from "@/lib/ip-whois";

/**
 * アクセス記録の「場所」「接続元の組織」での絞り込み（2026-10-02 指示: 表に出す項目は絞れるように）。
 *
 * どちらも記録には残っておらず、接続元IPから表示のたびに求めている（場所は割り当て表、組織は JPNIC の結果）。
 * そのため DB の条件にそのまま書けない。記録に出てくる接続元IPの種類を集め、
 * 1 つずつ「場所」「組織」を求めて条件に当てはめ、当たった IP で記録を絞る。
 *
 * 接続元IPの種類は少ない（利用者の場所の数ほど）が、集めるには記録を読む必要があるので 60 秒覚えておく
 */
const TTL_MS = 60_000;

/**
 * 画面に出している国名（components 側の countryName と同じ出しかた）。
 * あちらは画面専用の部品なので、サーバーでは同じことをここで行う
 */
function placeLabel(code: string | null, locale: string, localLabel: string): string {
  if (!code) return "";
  if (code === "local") return localLabel;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
let cachedIps: { at: number; actions: string; ips: string[] } | null = null;

/** 記録に出てくる接続元IP（記録に書かれたままの文字。「相手, 中継」の並びもそのまま） */
async function distinctIps(actions: string[]): Promise<string[]> {
  const key = actions.join(",");
  if (cachedIps && cachedIps.actions === key && Date.now() - cachedIps.at < TTL_MS) {
    return cachedIps.ips;
  }
  const ips = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.auditLog.findMany({
      where: { action: { in: actions } },
      select: { id: true, diff: true },
      orderBy: { id: "asc" },
      take: 5000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const r of batch) {
      const ip = ((r.diff ?? {}) as { ip?: unknown }).ip;
      if (typeof ip === "string" && ip !== "") ips.add(ip);
    }
    cursor = batch[batch.length - 1]!.id;
  }
  cachedIps = { at: Date.now(), actions: key, ips: [...ips] };
  return cachedIps.ips;
}

/** 文字の条件が「何も絞っていない」か（打ちかけの空欄） */
const inactive = (f: ColumnFilter | undefined): boolean =>
  !f || f.kind !== "text" || (f.value.trim() === "" && f.op !== "empty" && f.op !== "notEmpty");

/**
 * 候補の文字のどれかで条件に当てはまるか。
 * 「空白」は全部が空のとき、「空白でない」はどれかが空でないときに当たる
 */
function matchesAny(values: (string | null)[], f: ColumnFilter): boolean {
  const filled = values.filter((v): v is string => !!v);
  if (f.kind === "text" && f.op === "empty") return filled.length === 0;
  if (f.kind === "text" && f.op === "notEmpty") return filled.length > 0;
  return filled.some((v) => matchesFilter(v, f));
}

/**
 * 「場所」「接続元の組織」の条件から、記録の絞り込みを作る。どちらも絞っていなければ null。
 * 場所は画面に出ている国名（言語に合わせたもの）と国コード、組織は日本語名・英語名・ネットワーク名のどれかで当てる
 */
export async function computedIpCondition(
  filters: Record<string, ColumnFilter>,
  actions: string[],
  locale: string,
  localLabel: string,
): Promise<Prisma.AuditLogWhereInput | null> {
  const place = filters.country;
  const org = filters.org;
  if (inactive(place) && inactive(org)) return null;

  const raws = await distinctIps(actions);
  const firsts = raws.map((r) => clientIp(r));
  const whois = inactive(org) ? new Map() : await whoisFor(firsts.filter((v): v is string => !!v));

  const ok = (raw: string | null, first: string | null): boolean => {
    if (!inactive(place)) {
      const code = countryOf(raw);
      const label = placeLabel(code, locale, localLabel);
      if (!matchesAny([label, code && code !== "local" ? code : null], place!)) return false;
    }
    if (!inactive(org)) {
      const w = first ? whois.get(first)?.info : undefined;
      if (!matchesAny([w?.orgJa ?? null, w?.orgEn ?? null, w?.networkName ?? null], org!)) {
        return false;
      }
    }
    return true;
  };

  const hits = raws.filter((r, i) => ok(r, firsts[i] ?? null));
  // 接続元IPの無い記録（ログアウトなど一部の記録）は、条件が「空白」に当たるときだけ含める
  const withoutIp = ok(null, null);
  const or: Prisma.AuditLogWhereInput[] = hits.map((ip) => ({
    diff: { path: ["ip"], equals: ip },
  }));
  if (withoutIp) or.push({ diff: { path: ["ip"], equals: Prisma.DbNull } });
  return or.length > 0 ? { OR: or } : { id: { in: [] } };
}
