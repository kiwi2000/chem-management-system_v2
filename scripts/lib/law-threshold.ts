/**
 * 法令の但し書きから、判定に使う閾値を取り出す。
 *
 * 毒劇法（毒物及び劇物指定令）の但し書きは、ほとんどが
 * 「ただし、<物質名><濃度>％以下を含有するものを除く。」という形をしている。
 * この濃度が判定の境目そのものなのに、いまは文章の中にしか無い。
 *
 * ここでやるのは**取り出しと組み立てだけ**で、書き込みはしない。
 * 取り出した結果を人が確かめてから流せるようにするため
 * （167件を機械任せで書き込むと、間違いに気づけない）。
 */

/** 但し書きの形 */
export type ExclusionKind =
  /** ただし、<物質><数値>％以下を含有するものを除く。 */
  | "simple"
  /** 上に加えて「マイクロカプセル製剤にあつては、<別の数値>％」が付く */
  | "microcapsule"
  /** 濃度のほかに条件が付く（徐放性製剤・着色・用途など） */
  | "conditional"
  /** 「次に掲げるものを除く」＋列挙。別の物質が並ぶので、1つの閾値にできない */
  | "list"
  /** 濃度の但し書きが無い */
  | "none";

export interface Exclusion {
  kind: ExclusionKind;
  /** 除外の境目（％）。無いときは null */
  pct: number | null;
  /** 但し書きが名指ししている物質名。無いときは null */
  subject: string | null;
  /** 濃度以外に付いている条件。無いときは null */
  condition: string | null;
  /** マイクロカプセル製剤のときの別の境目（％） */
  microPct: number | null;
}

/** 漢数字の桁。位取り（十・百・千）は使われていないので、1文字＝1桁で読む */
const DIGITS: Record<string, string> = {
  〇: "0",
  一: "1",
  二: "2",
  三: "3",
  四: "4",
  五: "5",
  六: "6",
  七: "7",
  八: "8",
  九: "9",
};

/**
 * 漢数字を数にする。`〇・一` → 0.1、`四七・五` → 47.5。
 *
 * **位取りの書き方（十・百・千）が出てきたら null を返す。**
 * 1文字ずつ読む方式では `十` を正しく扱えないので、
 * 黙って別の数にするより、気づける形で止めるほうがよい。
 */
export function kanjiToNumber(raw: string): number | null {
  const s = raw.trim();
  if (s.length === 0) return null;
  if (/[十百千万億]/.test(s)) return null;

  let out = "";
  for (const ch of s) {
    if (ch === "・" || ch === ".") {
      if (out.includes(".")) return null; // 小数点が2つ
      out += ".";
      continue;
    }
    const d = DIGITS[ch] ?? (/[０-９]/.test(ch) ? String(ch.charCodeAt(0) - 0xff10) : null);
    if (d === null) return null;
    out += d;
  }
  if (out === "" || out === ".") return null;
  const n = Number(out);
  return Number.isFinite(n) ? n : null;
}

/** 数として読める文字。ここを走査して濃度の桁を切り出す */
const NUMERIC = /[〇一二三四五六七八九０-９・.]/;

/**
 * 但し書きを読み解く。
 *
 * 濃度は「最初の％の直前にある数字の並び」として取る。
 * 化学物質の名前そのものに `一・一′―` のような数字が入るので、
 * 名前の側から探すと必ず取り違える。％を起点にして後ろから拾う。
 */
export function parseExclusion(note: string | null): Exclusion {
  const empty: Exclusion = {
    kind: "none",
    pct: null,
    subject: null,
    condition: null,
    microPct: null,
  };
  if (!note) return empty;

  const text = note.replace(/\s+/g, "");
  const at = text.indexOf("ただし、");
  if (at < 0) return empty;
  const body = text.slice(at + "ただし、".length);

  if (body.startsWith("次に掲げるものを除く")) {
    return { kind: "list", pct: null, subject: null, condition: body, microPct: null };
  }

  const pctAt = body.search(/[％%]/);
  if (pctAt < 0) return empty;

  // ％の直前から、数として読める文字をさかのぼる
  let start = pctAt;
  while (start > 0 && NUMERIC.test(body[start - 1] as string)) start -= 1;
  const pct = kanjiToNumber(body.slice(start, pctAt));
  if (pct === null) return empty;

  /*
    名指しの手前に、条件が前置きされることがある。
      「容量一リツトル以下の容器に収められたものであつて、亜セレン酸〇・…％以下を…」
    このまま名前として扱うと、突き合わせに失敗する。切り離して条件のほうへ回す。
  */
  const head = body.slice(0, start);
  const sep = Math.max(head.lastIndexOf("であつて、"), head.lastIndexOf("であって、"));
  const prefix = sep < 0 ? null : head.slice(0, sep + 4);

  // 名前の末尾に付く「として」は、濃度の言い回しであって名前の一部ではない
  const subject = (sep < 0 ? head : head.slice(sep + 5))
    .replace(/として$/, "")
    .replace(/[、。]$/, "");

  const rest = body.slice(pctAt + 1);

  // マイクロカプセル製剤だけは別の境目を持つ
  const micro = rest.match(/^（マイクロカプセル製剤にあつては、([^）]+?)[％%]）/);
  if (micro) {
    return {
      kind: "microcapsule",
      pct,
      subject,
      condition: `マイクロカプセル製剤は${kanjiToNumber(micro[1] as string) ?? "?"}％以下を除く`,
      microPct: kanjiToNumber(micro[1] as string),
    };
  }

  // 「以下を含有するものを除く。」なら、濃度だけが条件
  const tail = rest.replace(/^以下を含有/, "");
  const plain = /^するものを除く。?$/.test(tail);
  const suffix = plain
    ? null
    : tail
        .replace(/を除く。?$/, "")
        .replace(/^する/, "")
        .replace(/^し、/, "");

  const condition = [prefix, suffix].filter(Boolean).join(" ／ ") || null;
  if (condition === null) {
    return { kind: "simple", pct, subject, condition: null, microPct: null };
  }
  return { kind: "conditional", pct, subject, condition, microPct: null };
}

/**
 * 法文物質名と、但し書きが名指しする物質名を突き合わせる。
 *
 * 法文の名前は「〜及びこれを含有する製剤」のような形で、
 * 但し書きは物質そのものを指す。付いている言い回しを落としてから比べる。
 */
export function sameSubstance(statutoryName: string, subject: string | null): boolean {
  if (!subject) return false;
  const a = normalizeName(statutoryName);
  const b = normalizeName(subject);
  if (a.length === 0 || b.length === 0) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * 比べるための正規化。
 *
 * 同じ物質でも、法文の見出しと但し書きとで書きかたが揺れる。
 * 実際に見つかった揺れだけを落とす（削りすぎると、別の物質を同じと見なしてしまう）。
 *
 *   括弧の字   〔〕 と ［］ が混在する
 *   接続詞     「その塩類及びこれらの無水物」と「その塩類又はこれらの無水物」
 *   末尾の定型 「並びにこれらのいずれかを含有する製剤」など
 */
export function normalizeName(raw: string): string {
  let s = raw
    .replace(/\s+/g, "")
    .replace(/（別名[^）]*）/g, "")
    // 角括弧の字を揃える。同じ物質が別物に見える原因になる
    .replace(/[〔【]/g, "［")
    .replace(/[〕】]/g, "］")
    // 「又は」と「及び」は、ここでは同じ意味で使われている
    .replace(/又は/g, "及び");

  // 末尾に付く定型の言い回しを、無くなるまで落とす
  const TAILS = [
    /(及び|並びに)?(これら|これ)?(の)?(いずれか)?を?含有する製剤$/,
    /(及び|並びに)?これらの無水物$/,
    /(、|及び|並びに)?その塩類$/,
    /(、|及び|並びに)?これらの塩類$/,
    /[、。]$/,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of TAILS) {
      const next = s.replace(re, "");
      if (next !== s) {
        s = next;
        changed = true;
      }
    }
  }
  return s;
}
