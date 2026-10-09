/**
 * 接続元IPアドレスの決まり（許可リスト・拒否リスト）の読み取りと照らし合わせ。
 *
 * 画面（システム設定）でも、入口（proxy）でも同じものを使う。
 * 画面で「書けた」決まりが入口で読めない、という食い違いを起こさないため。
 *
 * 書けるもの:
 *   203.0.113.5         … 1 つのアドレス（IPv4）
 *   203.0.113.0/24      … 範囲（IPv4）
 *   2001:db8::1         … 1 つのアドレス（IPv6）
 *   2001:db8:1234::/48  … 範囲（IPv6。家庭や会社の回線は /48〜/64 で配られることが多い）
 *
 * IPv4 は 4 つの 10 進数だけを受け付ける。`010.1.1.1`（8 進数に見える）や
 * `3232235777`（1 つの数）のような書き方は断る。読み方が食い違うと、通すつもりの無い相手を通してしまう
 */

export interface ParsedIp {
  family: 4 | 6;
  /** アドレスを数にしたもの。IPv4 は 32 ビット、IPv6 は 128 ビット */
  value: bigint;
}

export interface ParsedIpRule {
  family: 4 | 6;
  base: bigint;
  /** 範囲の上位ビット数。1 つのアドレスなら 32（IPv4）・128（IPv6） */
  bits: number;
}

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseV6(s: string): bigint | null {
  if (!/^[0-9a-f:.]+$/i.test(s)) return null;
  // 末尾が IPv4 の書き方（::ffff:192.0.2.1 など）なら、16 ビット 2 つに直す
  let text = s;
  const v4Tail = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const v4 = parseV4(v4Tail[2]!);
    if (v4 === null) return null;
    text = `${v4Tail[1]}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && groups < 1) return null;
  const all = [...head, ...Array<string>(groups).fill("0"), ...tail];
  if (all.length !== 8) return null;
  let value = 0n;
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

/** アドレスを読む。IPv4 を包んだ IPv6（::ffff:192.0.2.1）は IPv4 として扱う。読めなければ null */
export function parseIp(raw: string): ParsedIp | null {
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (!s.includes(":")) {
    const v4 = parseV4(s);
    return v4 === null ? null : { family: 4, value: v4 };
  }
  const v6 = parseV6(s);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) return { family: 4, value: v6 & 0xffffffffn };
  return { family: 6, value: v6 };
}

/** 決まり 1 件を読む（1 つのアドレスか、`/` 付きの範囲）。読めなければ null */
export function parseIpRule(raw: string): ParsedIpRule | null {
  const s = raw.trim();
  const slash = s.indexOf("/");
  if (slash < 0) {
    const ip = parseIp(s);
    return ip ? { family: ip.family, base: ip.value, bits: ip.family === 4 ? 32 : 128 } : null;
  }
  const ip = parseIp(s.slice(0, slash));
  const bitsText = s.slice(slash + 1);
  if (!ip || !/^\d{1,3}$/.test(bitsText)) return null;
  const bits = Number(bitsText);
  const width = ip.family === 4 ? 32 : 128;
  if (bits > width) return null;
  return { family: ip.family, base: ip.value, bits };
}

export const isValidIpRule = (raw: string): boolean => parseIpRule(raw) !== null;

/** 範囲の最初と最後のアドレス（数） */
export function ruleBounds(rule: ParsedIpRule): { start: bigint; end: bigint } {
  const width = BigInt(rule.family === 4 ? 32 : 128);
  const hostBits = width - BigInt(rule.bits);
  const size = 1n << hostBits;
  const start = (rule.base >> hostBits) << hostBits;
  return { start, end: start + size - 1n };
}

/** アドレスが決まりに当てはまるか。読めないアドレス・決まりは「当てはまらない」 */
export function ipMatchesRule(ip: string, rule: string): boolean {
  const a = parseIp(ip);
  const r = parseIpRule(rule);
  if (!a || !r || a.family !== r.family) return false;
  const { start, end } = ruleBounds(r);
  return a.value >= start && a.value <= end;
}

export const ipMatchesAny = (ip: string, rules: readonly string[]): boolean =>
  rules.some((r) => ipMatchesRule(ip, r));
