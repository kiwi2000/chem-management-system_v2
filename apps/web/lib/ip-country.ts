import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 接続元のおよその国。
 *
 * 手元の表だけで判定する。**外部の会社に問い合わせない。**
 * このシステムは外へ一切出さない作りにしてあり、
 * ログインの記録に残るアドレスは会社の回線そのものなので、外へ送りたくない。
 *
 * 表は scripts/build-ip-country.ts が作る（世界の5つのIPアドレス管理団体が
 * 公開している割り当て表が元。無料で、登録も要らない）。
 *
 * **分かるのは「そのアドレスがどの国の団体に割り当てられているか」**であって、
 * 使っている人が今どこにいるかではない。海外の事業者を経由すればその国に見える。
 * 「見慣れない国から入られていないか」に気づくためのものと割り切る。
 */

interface Table {
  codes: string[];
  /** IPv4。開始・終わり（どちらも含む）・国。開始の順に並んでいる */
  v4Start: Uint32Array;
  v4End: Uint32Array;
  v4Code: Uint16Array;
  /** IPv6。上位64ビットを2つに分けて持つ。上位の順に並んでいる */
  v6Hi: BigUint64Array;
  v6Len: Uint8Array;
  v6Code: Uint16Array;
}

let table: Table | null = null;
let loadFailed = false;

/**
 * 表を読む。1度だけ。
 *
 * 読めなくても業務は止めない（場所が出ないだけ）。
 * ただし黙って消えると気づけないので、1回だけ記録に残す。
 */
function load(): Table | null {
  if (table || loadFailed) return table;
  try {
    const buf = readTable();
    if (buf.subarray(0, 4).toString("ascii") !== "IPC1") throw new Error("形式が違います");

    let o = 4;
    const codeCount = buf.readUInt16LE(o);
    o += 2;
    const codes: string[] = [];
    for (let i = 0; i < codeCount; i += 1) {
      codes.push(buf.subarray(o, o + 2).toString("ascii"));
      o += 2;
    }

    const v4Count = buf.readUInt32LE(o);
    o += 4;
    const v4Start = new Uint32Array(v4Count);
    const v4End = new Uint32Array(v4Count);
    const v4Code = new Uint16Array(v4Count);
    for (let i = 0; i < v4Count; i += 1) {
      v4Start[i] = buf.readUInt32LE(o);
      v4End[i] = buf.readUInt32LE(o + 4);
      v4Code[i] = buf.readUInt16LE(o + 8);
      o += 10;
    }

    const v6Count = buf.readUInt32LE(o);
    o += 4;
    const v6Hi = new BigUint64Array(v6Count);
    const v6Len = new Uint8Array(v6Count);
    const v6Code = new Uint16Array(v6Count);
    for (let i = 0; i < v6Count; i += 1) {
      v6Hi[i] = (BigInt(buf.readUInt32LE(o)) << 32n) | BigInt(buf.readUInt32LE(o + 4));
      v6Len[i] = buf.readUInt8(o + 8);
      v6Code[i] = buf.readUInt16LE(o + 9);
      o += 11;
    }

    table = { codes, v4Start, v4End, v4Code, v6Hi, v6Len, v6Code };
    return table;
  } catch (e) {
    loadFailed = true;
    console.error("接続元の国の表が読めません（場所は出ません）:", e);
    return null;
  }
}

/**
 * 表の置き場。
 *
 * 動かす場所によって作業ディレクトリが変わる（アプリは apps/web、
 * 試験はリポジトリの根）。どちらでも読めるように、順に当たる。
 * 決め打ちにすると、片方でだけ黙って場所が出なくなる（実際に起きた）。
 */
const CANDIDATES = ["data/ip-country.bin", "apps/web/data/ip-country.bin"];

function readTable(): Buffer {
  const tried: string[] = [];
  for (const rel of CANDIDATES) {
    const path = resolve(process.cwd(), rel);
    try {
      return readFileSync(path);
    } catch {
      tried.push(path);
    }
  }
  throw new Error(`見つかりません: ${tried.join(" / ")}`);
}

/** 自分自身。開発中はこれしか出ない */
const LOOPBACK = "local";

/**
 * その接続元がどこか。
 *
 *   2文字の国コード … 分かった
 *   "local"        … 自分自身（開発中など）
 *   null           … 分からない（表に無い・形が違う・表が読めない）
 */
export function countryOf(raw: string | null): string | null {
  if (!raw) return null;
  // 並んでいるときは先頭が相手（middleware と同じ見かた）
  const ip = (raw.split(",")[0] ?? "").trim().toLowerCase();
  if (!ip) return null;
  if (ip === "::1" || ip === "127.0.0.1" || ip.startsWith("127.")) return LOOPBACK;

  // ::ffff:192.0.2.1 の書き方は、中のIPv4として見る
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const target = mapped?.[1] ?? ip;

  const t = load();
  if (!t) return null;
  return target.includes(":") ? lookupV6(t, target) : lookupV4(t, target);
}

function lookupV4(t: Table, ip: string): string | null {
  const n = toV4(ip);
  if (n === null) return null;
  // 社内・自宅の回線などは表に無いこともある。その場合は素直に「分からない」
  let lo = 0;
  let hi = t.v4Start.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (n < (t.v4Start[mid] as number)) hi = mid - 1;
    else if (n > (t.v4End[mid] as number)) lo = mid + 1;
    else return t.codes[t.v4Code[mid] as number] ?? null;
  }
  return null;
}

function lookupV6(t: Table, ip: string): string | null {
  const hiBits = toV6Hi(ip);
  if (hiBits === null) return null;
  // 上位から見て、いちばん細かく一致するものを採る
  let lo = 0;
  let hi = t.v6Hi.length - 1;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if ((t.v6Hi[mid] as bigint) <= hiBits) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best === null) return null;
  // 前へさかのぼって、範囲に入るものを探す（同じ始まりの粗い枠が前にあることがある）
  for (let i = best; i >= 0 && i > best - 64; i -= 1) {
    const len = t.v6Len[i] as number;
    const mask = len === 0 ? 0n : (~0n << BigInt(64 - len)) & 0xffffffffffffffffn;
    if (((t.v6Hi[i] as bigint) & mask) === (hiBits & mask)) {
      return t.codes[t.v6Code[i] as number] ?? null;
    }
  }
  return null;
}

function toV4(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let v = 0;
  for (const s of p) {
    // 08 のような書き方は別物として扱う（同じ数に見せる細工を通さない）
    if (!/^(0|[1-9]\d{0,2})$/.test(s)) return null;
    const n = Number(s);
    if (n > 255) return null;
    v = v * 256 + n;
  }
  return v >>> 0;
}

/** 上位64ビットだけ見る。国の割り当ては /48 より粗いので、これで足りる */
function toV6Hi(ip: string): bigint | null {
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = (parts[0] ?? "").split(":").filter((s) => s.length > 0);
  const tail = (parts[1] ?? "").split(":").filter((s) => s.length > 0);
  if (parts.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const groups =
    parts.length === 2 ? [...head, ...Array<string>(fill).fill("0"), ...tail] : [...head];
  if (groups.length !== 8) return null;
  let out = 0n;
  for (let i = 0; i < 4; i += 1) {
    if (!/^[0-9a-f]{1,4}$/.test(groups[i] as string)) return null;
    out = (out << 16n) | BigInt(parseInt(groups[i] as string, 16));
  }
  return out;
}
