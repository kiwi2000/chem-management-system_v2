/**
 * 「決まった場所からだけ入れる」ための判定。
 *
 * 許可する相手は環境変数で渡す。コードにアドレスを書かない
 * （変わるたびに作り直しになるうえ、リポジトリに社内の情報が残るため）。
 *
 * **空のときは制限しない。** これは手抜きではなく安全弁で、
 * 設定を誤って全員が締め出されたとき、値を消せば必ず戻れるようにするためのもの。
 *
 * ここは判定だけを持ち、環境変数の読み取りやログは middleware 側に置く。
 * 締め出し事故を起こしうる場所なので、試験を書ける形にしておく。
 */

/** どう扱うか。`off` は許可リストが空、つまり制限していない状態 */
export type IpVerdict = "off" | "allow" | "deny";

/**
 * 相手のアドレスを取り出す。
 *
 * Railway の入口は `x-forwarded-for` を**書き換えて**渡してくる
 * （利用者が偽の値を付けても消える。本番に偽の値を投げて確かめた）。
 * 書き換えられた値は「相手, 内部の中継」の順に並ぶので、**先頭**を見る。
 *
 * 前に Cloudflare のようなものを置くと並びが変わる。
 * 置くときは、ここを見直すこと。
 */
export function clientIp(header: string | null): string | null {
  const first = (header ?? "").split(",")[0]?.trim();
  return first ? normalize(first) : null;
}

/** 前後の記号と、あとに付く接続口の番号を落とす */
function normalize(raw: string): string {
  let ip = raw.trim().toLowerCase();
  // [2001:db8::1]:443 のような書き方
  const bracket = ip.match(/^\[(.+)\](?::\d+)?$/);
  if (bracket?.[1]) return bracket[1];
  // 192.0.2.1:443（IPv6 は `:` を含むので、1個のときだけ接続口とみなす）
  if ((ip.match(/:/g) ?? []).length === 1) ip = ip.split(":")[0] ?? ip;
  return ip;
}

/** 環境変数の1行を、許可する相手の並びにする。カンマ・空白・改行のどれで区切ってもよい */
export function parseAllowList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((s) => normalize(s))
    .filter((s) => s.length > 0);
}

/**
 * 通してよいかを決める。
 *
 * 許可リストが空なら `off`。相手が分からないときは `deny`
 * （分からないものを通すと、制限した意味が無くなる）。
 */
export function ipVerdict(ip: string | null, allowList: string[]): IpVerdict {
  if (allowList.length === 0) return "off";
  if (!ip) return "deny";
  return allowList.some((rule) => matches(ip, rule)) ? "allow" : "deny";
}

/** 1件の決まりに当てはまるか。`192.0.2.0/24` のような範囲の書き方に対応する（IPv4 のみ） */
function matches(ip: string, rule: string): boolean {
  const slash = rule.indexOf("/");
  if (slash < 0) return ip === rule;

  const base = toV4(rule.slice(0, slash));
  const target = toV4(ip);
  const bits = Number(rule.slice(slash + 1));
  // 範囲の書き方は IPv4 だけ。IPv6 の範囲は使えない（要るようになったら足す）
  if (base === null || target === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  if (bits === 0) return true;
  const mask = bits === 32 ? -1 : ~((1 << (32 - bits)) - 1);
  return (base & mask) === (target & mask);
}

/** IPv4 を数値にする。形が違えば null */
function toV4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8) | n;
  }
  return value;
}
