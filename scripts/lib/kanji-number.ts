/**
 * 化学名の中の漢数字を算用数字に直す。
 *
 * 法令の原文は縦書きの書式なので、位置番号（ロカント）が漢数字で書かれている。
 *
 * ```
 * 一・二・三・四・十・十―ヘキサクロロ―六・七―エポキシ―…
 * → 1,2,3,4,10,10-ヘキサクロロ-6,7-エポキシ-…
 * ```
 *
 * **直してよいのは書式だけ。語は変えない。**
 * 「ターシャリ」を `tert` にするような書き換えはしない
 * （`docs/法規制データの作り方.md` 第3章）。
 *
 * 位置番号は 1〜99 に収まる。それ以上の桁は化学名には出てこないので扱わない。
 */

const DIGIT: Record<string, number> = {
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 「十三」「二十」「十」など、1つのかたまりを数に直す。数でなければ null */
export function kanjiToNumber(token: string): number | null {
  const t = token.trim();
  if (t === "") return null;
  if (DIGIT[t] !== undefined) return DIGIT[t]!;

  const at = t.indexOf("十");
  if (at < 0) {
    // 「〇〇八二」のような並びは位取りではなく、数字が並んでいるだけ。
    // **先頭のゼロを落とさない**（「〇・〇〇八二」は 0.0082 で、桁が意味を持つ）
    if (![...t].every((c) => DIGIT[c] !== undefined)) return null;
    return null;
  }
  const head = t.slice(0, at);
  const tail = t.slice(at + 1);
  const tens = head === "" ? 1 : (DIGIT[head] ?? null);
  const ones = tail === "" ? 0 : (DIGIT[tail] ?? null);
  if (tens === null || ones === null) return null;
  return tens * 10 + ones;
}

/** 桁をそのまま保って直す。「〇〇八二」→「0082」。読めなければ null */
function digitsOnly(token: string): string | null {
  if (token === "" || [...token].some((c) => DIGIT[c] === undefined)) return null;
  return [...token].map((c) => String(DIGIT[c])).join("");
}

/**
 * 文字列の中の漢数字を算用数字に直す。
 *
 * **直すかどうかは「後ろに何が来るか」で決める。**
 * 位置番号と、語の一部の漢数字は、字としては同じ「四」なので、
 * 見分けは前後の文字でしかつかない。
 *
 *   後ろが区切りか英字      → 位置番号。直す（`二―` `二Ｈ` `四・六`）
 *   後ろがかな・漢字        → 語の一部。直さない（`四塩化炭素` `四アルキル鉛`）
 */
export function convertKanjiLocants(text: string): string {
  const kanji = "[〇一二三四五六七八九十]+";
  /*
    直す条件は「後ろが**語の続きでない**こと」。
    位置番号のあとには区切り（`・` `―` `）`）か、英字（`2Ｈ` `4ａ`）が来る。
    かなや漢字が続くときは語の一部——「四塩化炭素」「四アルキル鉛」の「四」——なので直さない。
  */
  const notWord = "(?![〇一二三四五六七八九十ぁ-んァ-ヴー一-龥])";
  const re = new RegExp(`(${kanji})${notWord}`, "g");
  return text.replace(re, (whole: string) => {
    const n = kanjiToNumber(whole);
    if (n !== null) return String(n);
    const d = digitsOnly(whole);
    return d ?? whole;
  });
}
