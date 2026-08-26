/**
 * 法令の号番号（漢数字）を数に直す。
 *
 * 化学名の中の位置番号を直す `kanji-number.ts` とは別もの。
 * こちらは「百三十四」のような**位取りのある数**を読む。
 * 号番号は 1〜999 に収まる（別表第一は515号が最大）。
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

/** 「百三十四」→ 134。読めなければ null */
export function kanjiCount(text: string): number | null {
  const s = text.trim();
  if (s === "") return null;

  /*
    **位取りの字（十・百）が無いときは、数字が並んでいるだけ。**
    別表の枝番は「一〇」「二九」のように書かれる（縦書きの書き方）。
    位取りとして読むと 0 や 9 になってしまう
  */
  if (!s.includes("十") && !s.includes("百")) {
    let digits = "";
    for (const ch of s) {
      const d = DIGIT[ch];
      if (d === undefined) return null;
      digits += String(d);
    }
    return Number(digits);
  }
  let total = 0;
  let cur = 0;
  let seen = false;
  for (const ch of s) {
    if (DIGIT[ch] !== undefined) {
      cur = DIGIT[ch]!;
      seen = true;
    } else if (ch === "十") {
      total += (cur || 1) * 10;
      cur = 0;
      seen = true;
    } else if (ch === "百") {
      total += (cur || 1) * 100;
      cur = 0;
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? total + cur : null;
}

/**
 * 号の見出しを、法令が付けた番号の文字列にする。
 *
 * 枝番は「十九の四」のように書かれる。**枝番は数に潰さない**。
 * 潰すと 19号 と 19の4号 が同じになり、突合が壊れる
 */
export function itemNumber(title: string): string | null {
  const t = title.replace(/[（）()]/g, "").trim();
  const parts = t.split("の");
  const nums = parts.map((p) => kanjiCount(p));
  if (nums.some((n) => n === null)) return null;
  return nums.join("-");
}

/**
 * 細目の見出しを番号にする。
 *
 * 別表の中の細目は**算用数字**で書かれている（`１` `３の２`）。
 * 号の見出し（漢数字）とは書き方が違うので、別に読む
 */
export function subitemNumber(title: string): string | null {
  const t = title
    .replace(/[（）()]/g, "")
    .normalize("NFKC")
    .trim();
  if (t === "") return null;
  const parts = t.split("の");
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map((p) => String(Number(p))).join("-");
}
