/**
 * 取り込んだ行から、画面に出す値を取り出す決まり。
 *
 * 外部データベースの行は、資料によって形がまるで違う。
 *
 * ```
 * LOLI ENCS    (5)-3714
 * LOLI TSCA    Present (ACTIVE)
 * LOLI EINECS  "215-637-1" As ...;  "247-704-6" As ...     ← 1行に2つ
 * LOLI 豪州     Present                                     ← 番号が無い
 * ```
 *
 * 資料ごとに読み方を書くと、資料が増えるたびにコードが増える。
 * **どう取り出すかをデータで持ち**、ここでは当てるだけにする。
 *
 *   取得条件（`pattern`） … 行のどこを拾うか。**全件一致**なので1行から複数取れる
 *   表示の書式（`format`）… 拾ったものをどう並べるか。`$1` などが使える
 *
 * 取得条件が空なら、行があること自体が答え（「該当」など）。
 * 書式をそのまま1つ返す。
 */

export interface ExtractRule {
  /** 取り出す正規表現。空なら取り出さない（行があることだけを見る） */
  pattern: string | null;
  /** 表示の書式。`$0` は一致した全体、`$1` 以降は括弧の中 */
  format: string;
}

export interface ExtractResult {
  /** 取り出した値。同じ値は1つにまとめる */
  values: string[];
  /**
   * 正規表現が壊れているときの説明。
   * **空配列と区別できるようにする。**「一致しなかった」のか
   * 「書き方が壊れている」のかが分からないと、直しようがない
   */
  error: string | null;
}

/**
 * 1行から取り出せる値の上限。
 *
 * `(?:)` のような何にでも当たる書き方をすると、文字数だけ一致してしまう。
 * 画面に何百も並んでも読めないので、ここで止める。
 */
export const EXTRACT_MAX = 20;

/** 正規表現として使えるか。設定画面で書いている途中の確認に使う */
export function compileExtract(pattern: string): { regex: RegExp | null; error: string | null } {
  try {
    return { regex: new RegExp(pattern, "g"), error: null };
  } catch (e) {
    return { regex: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 書式の `$0`〜`$9` を、一致したものに置き換える */
function fill(format: string, match: RegExpMatchArray): string {
  return format.replace(/\$(\d)/g, (_, d: string) => match[Number(d)] ?? "");
}

/**
 * 決まりを1行に当てる。
 *
 * **取得条件が空なら、書式をそのまま1つ返す。**
 * 番号を持たない名簿（載っているかどうかだけのもの）はこれで足りる。
 */
export function applyExtract(rule: ExtractRule, data: string): ExtractResult {
  const pattern = rule.pattern?.trim() ?? "";
  if (pattern === "") return { values: [rule.format], error: null };

  const { regex, error } = compileExtract(pattern);
  if (!regex) return { values: [], error };

  const values: string[] = [];
  const seen = new Set<string>();
  for (const match of data.matchAll(regex)) {
    const value = fill(rule.format, match);
    // 同じ番号が2回書かれていることがある。並びは最初に出た順のまま
    if (value === "" || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
    if (values.length >= EXTRACT_MAX) break;
  }
  return { values, error: null };
}
