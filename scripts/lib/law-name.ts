/**
 * 法令の原文の書き方を、**SDS で使う書き方**に直す。
 *
 * 法令は縦書きの組版なので、位置番号も数量も漢数字で書かれ、区切りは中黒になる。
 * SDS はふつう算用数字で書くので、そこに合わせる
 * （`docs/法規制データの作り方.md` 第3章）。
 *
 * ```
 * 一・二・三・四―ヘキサクロロ… → １，２，３，４－ヘキサクロロ…
 * ビシクロ［二・二・一］        → ビシクロ［２．２．１］
 * Ｎ・Ｎ′―ジトリル             → Ｎ，Ｎ’－ジトリル
 * ```
 *
 * **直すのは書式だけ。語は変えない。**
 * 「ターシャリ」を `tert` にしたり、「アルファ」を `α` にしたりはしない。
 * それは表記の書き換えであって、書式の直しではない（第3章）。
 *
 * 数字に見えても**語の一部**なら直さない。ここがいちばん間違えやすい。
 *
 * ```
 * 四アルキル鉛  → そのまま（「４アルキル鉛」は別のものになってしまう）
 * 二硫化炭素    → そのまま
 * 炭素数が八の  → 炭素数が８の（数量なので直す）
 * 四十八パーセント → ４８パーセント（同上）
 * ```
 */

const DIGIT: Record<string, string> = {
  〇: "０",
  一: "１",
  二: "２",
  三: "３",
  四: "４",
  五: "５",
  六: "６",
  七: "７",
  八: "８",
  九: "９",
};

/** 漢数字1文字を数に。読めなければ null */
function digitOf(ch: string): number | null {
  const d = DIGIT[ch];
  return d === undefined ? null : Number(d.charCodeAt(0) - "０".charCodeAt(0));
}

/**
 * 漢数字のかたまりを算用数字にする。
 *
 * 位取りのあるもの（`十三` `四十八`）は数に直し、
 * 位取りのないもの（`〇〇八二`）は**桁をそのまま置き換える**。
 * 「〇・〇〇八二」は 0.0082 で、先頭のゼロに意味があるため
 */
function toArabic(run: string): string | null {
  if (run.includes("十") || run.includes("百")) {
    let total = 0;
    let cur = 0;
    for (const ch of run) {
      const d = digitOf(ch);
      if (d !== null) {
        cur = d;
        continue;
      }
      if (ch === "十") {
        total += (cur || 1) * 10;
        cur = 0;
        continue;
      }
      if (ch === "百") {
        total += (cur || 1) * 100;
        cur = 0;
        continue;
      }
      return null;
    }
    return String(total + cur).replace(/\d/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 48 + 0xff10),
    );
  }
  let out = "";
  for (const ch of run) {
    const d = DIGIT[ch];
    if (d === undefined) return null;
    out += d;
  }
  return out;
}

/**
 * 漢数字のうしろに来るもので、**数量だと分かる**書き方。
 *
 * うしろが漢字やカタカナなら、ふつうは語の一部（`四塩化炭素` `四アルキル鉛`）。
 * ただしここに挙げたものが続くときは数量なので直す
 */
const UNIT_AFTER = [
  "以上",
  "以下",
  "未満",
  "を超え",
  "パーセント",
  "％",
  "トン",
  "リツトル",
  "リットル",
  "グラム",
  "ミリリツトル",
  "ミリリットル",
  "個",
  "倍",
  "号",
  // 並列に続くもの。「炭素数が九、十又は十一」の「十」は数量
  "又は",
  "若しくは",
  "及び",
  "並びに",
  "種",
  // λ の位置番号。「一ラムダ（五）」の「一」は語ではなく位置番号
  "ラムダ",
];

/** うしろが「語の続き」か。続きなら漢数字を直さない */
function isWordTail(rest: string): boolean {
  if (rest === "") return false;
  if (UNIT_AFTER.some((u) => rest.startsWith(u))) return false;
  // 漢字・カタカナが続けば語の一部。ひらがな・記号・英数字なら数量
  return /^[一-鿿ァ-ヺ]/.test(rest);
}

const KANJI_RUN = /[〇一二三四五六七八九十百]+/g;

/** 漢数字を算用数字に直す。**語の一部は直さない** */
export function convertNumerals(text: string): string {
  return text.replace(KANJI_RUN, (run, at: number) => {
    const rest = text.slice(at + run.length);
    if (isWordTail(rest)) return run;
    return toArabic(run) ?? run;
  });
}

/**
 * 条文の中でしか意味のない言い回しを落とす。
 *
 * 「以下「ＰＦＯＳ」という。」のような呼び名の宣言や、
 * 「第七条の表三の項において「アルドリン」という。」のような参照は、
 * **その条文の中での取り決め**であって、物質の名前ではない
 */
const REFERENCE_CLAUSES = [
  /第[^（()）「」]*において「[^」]*」という。/g,
  /以下「[^」]*」という。/g,
  /次号[^（()）]*において同じ。/g,
  /次項において同じ。/g,
  /以下同じ。/g,
  /次に掲げる[^（()）]*をいう。/g,
];

export function dropReferences(text: string): string {
  let out = text;
  for (const re of REFERENCE_CLAUSES) out = out.replace(re, "");
  // 参照だけが入っていた括弧は空になる。落とす
  out = out.replace(/（\s*）/g, "");
  /*
    参照を落とすと「（別名アルドリン。）」のように句点だけが残る。
    **落としてよいのは、中身が呼び名だけのときに限る。**
    「（〜のものに限る。）」の句点は、参照とは関わりなく元からある文の終わり
  */
  out = out.replace(/（(別名|以下)([^（()）。]*)。）/g, "（$1$2）");
  return out;
}

/**
 * von Baeyer 名の角括弧の中は、**中黒ではなくピリオド**で区切る。
 *
 * 原文の `ビシクロ［二・二・一］` は縦書きの書き方で、
 * 命名法としては `bicyclo[2.2.1]`。角括弧の外の中黒（`，` になる）とは役割が違う
 */
function fixBrackets(text: string): string {
  return text.replace(/［[^［］]*］/g, (whole) => {
    /*
      **ピリオドにしてよいのは、中身が数字だけの角括弧に限る。**
      `［二・二・一］` は環の大きさ（bicyclo[2.2.1]）だが、
      `［ａ・ｅ］` `［一・五―ａ］` は縮環の位置記号で、こちらは読点で区切る
    */
    const body = whole.replace(/（[^（）]*）/g, "");
    if (/[０-９0-9a-zA-Zａ-ｚＡ-Ｚ]/.test(body) && /[a-zA-Zａ-ｚＡ-Ｚ]/.test(body)) return whole;
    // 添字の中の中黒は読点なので、丸括弧の中は触らない
    return whole.replace(/（[^（）]*）|・/g, (piece) => (piece === "・" ? "．" : piece));
  });
}

/**
 * 中黒を読点にする。**位置番号の区切りのときだけ。**
 *
 * 中黒には2つの役目がある。
 *
 * ```
 * 一・二・三―トリクロロ                          位置番号の区切り → 読点
 * アルキル＝アクリラート・メチル＝メタクリラート  並列の中黒       → そのまま
 * ```
 *
 * 見分けは前後の文字で付く。**両隣が数字か英字なら位置番号。**
 */
function separators(text: string): string {
  const code = /[０-９0-9a-zA-Zａ-ｚＡ-Ｚ]/;
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch !== "・") {
      out += ch;
      continue;
    }
    const before = text[i - 1] ?? "";
    const after = text[i + 1] ?? "";
    if (!code.test(before) || !code.test(after)) {
      out += ch;
      continue;
    }
    // 「〇・〇〇八二」は 0.0082。小数点なのでピリオドにする
    out += before === "０" && !code.test(text[i - 2] ?? "") ? "．" : "，";
  }
  return out;
}

/**
 * 上付き添字の置き場が、そのままでは語を割ってしまうもの。
 *
 * 原文は縦書きなので `一ラ<Ruby>五<Rt>…</Rt></Ruby>ムダ` のように、
 * λ⁵ の 5 を「ラ」と「ムダ」の間に置いている。機械的に入れると
 * `一ラ（五）ムダ` となって「ラムダ」が割れる。**語の後ろに寄せる。**
 *
 * ここに足すのは、機械の読みでは直せないものだけ。**理由を必ず書く。**
 */
export const HAND_FIXES: { from: string; to: string; why: string }[] = [
  {
    from: "一ラ（五）ムダ",
    to: "一ラムダ（五）",
    why: "λ⁵ の上付き 5 が、縦書きの都合で「ラ」と「ムダ」の間に入っている",
  },
];

/** 上の例外を当てる */
export function applyHandFixes(text: string): string {
  let out = text;
  for (const f of HAND_FIXES) out = out.split(f.from).join(f.to);
  return out;
}

/**
 * 原文の名前を、登録する形に直す。
 *
 * 順番に意味がある。**漢数字を直す前に括弧の中を片づける**と、
 * 角括弧の中の中黒がピリオドに変わったあとで数字だけが直る
 */
export function toDisplayName(raw: string): string {
  let out = dropReferences(applyHandFixes(raw));
  out = fixBrackets(out);
  out = convertNumerals(out);
  return (
    separators(out)
      // ダッシュは全角ハイフンにそろえる
      .replace(/[―‐‒–—]/g, "－")
      // プライムはアポストロフィにそろえる
      .replace(/[′‵]/g, "’")
      .replace(/[″‶]/g, "”")
  );
}
