import { describe, expect, it } from "vitest";
import { expandTree, type ExpandLine, type LineLoader } from "./expansion-calc";

/**
 * 組成を末端まで下ろす計算。
 *
 * ここが狂うと、**判定の土台が全部狂う**。しかも数字が少しずれるだけなので、
 * 画面を見ても気づけない。手で組んだ木で、境目を確かめる。
 */

/** 木を手で組む。製品ID → 組成の行 */
function loaderOf(tree: Record<string, ExpandLine[]>): LineLoader {
  return (id) => Promise.resolve(tree[id] ?? null);
}

const sub = (id: string, cas: string | null, impurityPatternId = "ip-none") => ({
  id,
  casNumber: cas,
  impurityPatternId,
});
const line = (pct: string | null, x: Partial<ExpandLine> = {}): ExpandLine => ({
  contentPct: pct,
  substance: null,
  childProductId: null,
  ...x,
});

/** 出てきた行を、鍵→％の形にして見やすくする */
function asMap(
  lines: { casNormalized: string | null; substanceId: string | null; totalPct: string }[],
) {
  return Object.fromEntries(
    lines.map((l) => [l.casNormalized ?? `sub:${l.substanceId}`, l.totalPct]),
  );
}

describe("組成の展開", () => {
  it("1段だけの組成は、そのままの値になる", async () => {
    const e = await expandTree(
      "P",
      loaderOf({ P: [line("30", { substance: sub("s1", "7439-92-1") })] }),
    );
    expect(asMap(e.lines)).toEqual({ "7439-92-1": "30" });
  });

  it("入れ子は掛け算しながら下る", async () => {
    // 製品Pに原材料Mが5％、Mの中に銀が3％ → 製品全体では 0.15％
    const e = await expandTree(
      "P",
      loaderOf({
        P: [line("5", { childProductId: "M" })],
        M: [line("3", { substance: sub("ag", "7440-22-4") })],
      }),
    );
    expect(asMap(e.lines)).toEqual({ "7440-22-4": "0.15" });
  });

  it("同じCASが別の場所から出てきたら足す", async () => {
    /*
      ここが判定でいちばん効く。銅がAとBの両方から来る。
      別々に見ると 0.1％ に届かないのに、足すと超える、ということが起きる。
    */
    const e = await expandTree(
      "P",
      loaderOf({
        P: [line("50", { childProductId: "A" }), line("50", { childProductId: "B" })],
        A: [line("0.12", { substance: sub("cu-a", "7440-50-8") })],
        B: [line("0.08", { substance: sub("cu-b", "7440-50-8") })],
      }),
    );
    // 0.06 + 0.04 = 0.1。仕入先違いで別IDでも、CASが同じなら1行にまとまる
    expect(asMap(e.lines)).toEqual({ "7440-50-8": "0.1" });
  });

  it("CASを持たない物質は、物質そのものを鍵にする（まとめようがないため）", async () => {
    const e = await expandTree(
      "P",
      loaderOf({
        P: [line("10", { substance: sub("x1", null) }), line("20", { substance: sub("x2", null) })],
      }),
    );
    expect(asMap(e.lines)).toEqual({ "sub:x1": "10", "sub:x2": "20" });
  });

  /*
    かつては「残部」の行（含有率を空にして、残りを自動で当てる）があった。
    やめたので、**含有率を持たない行は何も足さない**。
    中身が分からないぶんとして扱われる
  */
  it("含有率を持たない行は、何も足さない", async () => {
    const e = await expandTree(
      "P",
      loaderOf({
        P: [
          line("30", { substance: sub("a", "1-1-1") }),
          line(null, { substance: sub("b", "2-2-2") }),
        ],
      }),
    );
    expect(asMap(e.lines)).toEqual({ "1-1-1": "30" });
  });

  it("中身が登録されていない原材料は、分からないぶんとして数える", async () => {
    /*
      **ここを「無い」として扱ってはいけない。**
      30％が不明な製品を「非該当」と言い切ることになる。
    */
    const e = await expandTree(
      "P",
      loaderOf({
        P: [
          line("70", { substance: sub("a", "1-1-1") }),
          line("30", { childProductId: "UNKNOWN" }),
        ],
      }),
    );
    expect(asMap(e.lines)).toEqual({ "1-1-1": "70" });
    expect(e.unknownPct).toBe("30");
    expect(e.totalPct).toBe("70");
  });

  it("分からないぶんも、入れ子の奥なら掛け算される", async () => {
    const e = await expandTree(
      "P",
      loaderOf({
        P: [line("50", { childProductId: "M" })],
        M: [
          line("40", { childProductId: "UNKNOWN" }),
          line("60", { substance: sub("a", "1-1-1") }),
        ],
      }),
    );
    // Mが50％、その中の40％が不明 → 製品全体では20％が不明
    expect(e.unknownPct).toBe("20");
    expect(asMap(e.lines)).toEqual({ "1-1-1": "30" });
  });

  it("同じ原材料が木の2か所に出てきても、二重に数えない", async () => {
    const e = await expandTree(
      "P",
      loaderOf({
        P: [line("20", { childProductId: "M" }), line("30", { childProductId: "M" })],
        M: [line("10", { substance: sub("a", "1-1-1") })],
      }),
    );
    // 20％の中の10％＝2％、30％の中の10％＝3％。合わせて5％
    expect(asMap(e.lines)).toEqual({ "1-1-1": "5" });
  });

  it("桁の小さいものが消えない", async () => {
    // 小数のまま足すと、こういう値が丸めで消える
    const e = await expandTree(
      "P",
      loaderOf({
        P: [line("0.001", { childProductId: "M" })],
        M: [line("0.5", { substance: sub("a", "1-1-1") })],
      }),
    );
    expect(asMap(e.lines)).toEqual({ "1-1-1": "0.000005" });
  });

  it("根の製品に組成が無ければ、全部が分からないぶんになる", async () => {
    const e = await expandTree("P", loaderOf({}));
    expect(e.lines).toEqual([]);
    expect(e.unknownPct).toBe("100");
  });
});

/**
 * 不純物種別（S21）。**CAS が同じでも種別が違えば別の行**にする。
 * 合算してしまうと、不純物ぶんを除外できなくなる
 */
describe("不純物種別での分けかた", () => {
  it("同じCASでも種別が違えば、別々に足す", async () => {
    const out = await expandTree(
      "p",
      loaderOf({
        p: [
          line("60", { substance: sub("s1", "108-88-3") }),
          line("40", { substance: sub("s2", "108-88-3", "ip-impurity") }),
        ],
      }),
    );
    expect(out.lines.map((l) => [l.casNormalized, l.impurityPatternId, l.totalPct])).toEqual([
      ["108-88-3", "ip-none", "60"],
      ["108-88-3", "ip-impurity", "40"],
    ]);
  });

  it("同じCAS・同じ種別なら、いままでどおり足す", async () => {
    const out = await expandTree(
      "p",
      loaderOf({
        p: [
          line("30", { substance: sub("s1", "108-88-3", "ip-impurity") }),
          line("20", { substance: sub("s2", "108-88-3", "ip-impurity") }),
        ],
      }),
    );
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]?.totalPct).toBe("50");
  });
});
