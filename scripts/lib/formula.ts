/**
 * 分子式から、その元素が重さの何％を占めるかを出す。
 *
 * 「鉛及びその化合物」の閾値は**鉛として**何％か、で決まる。
 * 酸化鉛（PbO）10％は、鉛としては 9.283％。ここを取り違えると、
 * 閾値の境目で答えが変わる。
 *
 * 分子式は LOLI の CasNames.Formula から取る。実際に出てくる書きかたは、
 *
 *   OZn            元素記号と数字が並ぶだけ（並び順は決まっていない）
 *   O4Pb3          数字が2桁以上になる
 *   CrH2O4.Pb      塩や水和物は「.」で区切って並ぶ
 *   Ca(NO3)2       括弧でくくって倍にする
 *   2H2O           先頭の数字は、その後ろ全体にかかる（水和物の書きかた）
 *   AsO2.1/2Zn     分数もある（AsO2 ひとつに Zn が半分＝Zn(AsO2)2 のこと）
 *   PbF2.01        個数が小数のこともある（「.」が区切りではなく小数点）
 *
 * **読めない書きかたは null を返す。**
 * 適当な数を返すと、判定が静かに間違う。読めないと分かれば、
 * 係数が無いものとして「そのままの値」で数えるので、多めに出る側に倒れる。
 */

/** 元素記号 → 個数 */
export type Composition = Map<string, number>;

/**
 * 分子式を、元素と個数に分ける。読めなければ null。
 *
 * `.` で区切られた部分（塩・水和物）は、すべて足し合わせる。
 * 「その化合物 1 モルに元素が何個あるか」が知りたいので、それで正しい。
 */
export function parseFormula(raw: string): Composition | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  // 電荷や状態の注記が付くものは、素直に読めないので扱わない
  if (/[+\-·•]/.test(text)) return null;

  /*
    「.」は成分の区切りだが、**小数点のこともある**
    （PbF2.01、Bi2Te2.67、Co0.2LiNi0.8O2）。

    **前後がどちらも数字なら小数点**、それ以外は区切り。
    「区切ったあとが数字だけなら小数」という見かたでは、
    Co0.2LiNi0.8O2 のように小数のあとに元素が続く形を取り違える。

    ただし数字のあとに「/」が続くときは分数の始まりなので、区切りとして扱う
    （AsO2.1/2Zn の「.1/2」は 0.1 ではなく「2分の1」）。
  */
  const parts = text.split(/(?<!\d)\.|\.(?!\d)|\.(?=\d+\/)/);

  const out: Composition = new Map();
  for (const part of parts) {
    const parsed = parsePart(part);
    if (!parsed) return null;
    for (const [sym, n] of parsed) out.set(sym, (out.get(sym) ?? 0) + n);
  }
  return out.size === 0 ? null : out;
}

/**
 * `.` で区切った1つぶん。
 *
 * 先頭の数字は、その後ろ全体にかかる（2H2O ＝ 水が2つ）。
 * 分数のこともある（1/2Zn ＝ Zn が半分）。個数が整数でなくなるが、
 * 重さを出すだけなので差し支えない。
 */
function parsePart(part: string): Composition | null {
  const s = part.trim();
  if (s.length === 0) return null;
  const lead = s.match(/^(\d+)(?:\/(\d+))?(.+)$/);
  if (lead) {
    const inner = parseGroup(lead[3] as string);
    if (!inner) return null;
    const den = lead[2] ? Number(lead[2]) : 1;
    if (den === 0) return null;
    const times = Number(lead[1]) / den;
    const out: Composition = new Map();
    for (const [sym, n] of inner) out.set(sym, n * times);
    return out;
  }
  return parseGroup(s);
}

/** 括弧を含む並びを読む */
function parseGroup(s: string): Composition | null {
  const out: Composition = new Map();
  let i = 0;

  const add = (sym: string, n: number) => out.set(sym, (out.get(sym) ?? 0) + n);

  while (i < s.length) {
    const ch = s[i] as string;

    if (ch === "(" || ch === "[") {
      // 対応する閉じ括弧まで取り出して、中を同じやりかたで読む
      const close = ch === "(" ? ")" : "]";
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === ch) depth += 1;
        else if (s[j] === close) depth -= 1;
        j += 1;
      }
      if (depth !== 0) return null;
      const inner = parseGroup(s.slice(i + 1, j - 1));
      if (!inner) return null;
      const num = s.slice(j).match(/^\d+/);
      const times = num ? Number(num[0]) : 1;
      for (const [sym, n] of inner) add(sym, n * times);
      i = j + (num ? num[0].length : 0);
      continue;
    }

    // 元素記号は「大文字1つ＋小文字0〜2つ」
    const el = s.slice(i).match(/^([A-Z][a-z]{0,2})(\d*(?:\.\d+)?)/);
    if (!el || !el[1]) return null;
    add(el[1], el[2] ? Number(el[2]) : 1);
    i += el[0].length;
  }

  return out.size === 0 ? null : out;
}

/**
 * その元素が重さの何％を占めるか。
 *
 * 原子量が1つでも分からない元素が混ざっていたら null を返す。
 * 分からないものを 0 として計算すると、**分母が小さくなって割合が大きく出る**。
 * 静かに間違うより、計算できないと分かるほうがよい。
 */
export function elementFraction(
  formula: string,
  element: string,
  weights: Map<string, number>,
): number | null {
  const comp = parseFormula(formula);
  if (!comp) return null;
  const count = comp.get(element);
  if (!count) return null;

  let total = 0;
  for (const [sym, n] of comp) {
    const w = weights.get(sym);
    if (w === undefined) return null;
    total += w * n;
  }
  if (total <= 0) return null;

  const w = weights.get(element) as number;
  return (w * count) / total;
}
