import { describe, expect, it } from "vitest";
import { parseNiteCell, revisionOfGuidance, splitCas, splitTopLevel } from "./nite";

/** NITE 統合版のセルの読み方。実データで見つかった書き方を網羅する（docs/GHS分類の原典/検証結果_DB項目.md） */
describe("parseNiteCell", () => {
  it("空・ハイフンは未評価", () => {
    expect(parseNiteCell("OZONE", "-").status).toBe("NOT_EVALUATED");
    expect(parseNiteCell("OZONE", "").status).toBe("NOT_EVALUATED");
    expect(parseNiteCell("OZONE", null).status).toBe("NOT_EVALUATED");
  });

  it("3 つの『該当しない』を書き分ける", () => {
    expect(parseNiteCell("EXPL", "区分に該当しない（分類対象外）").status).toBe("NOT_APPLICABLE");
    expect(parseNiteCell("EXPL", "区分に該当しない").status).toBe("NOT_CLASSIFIED");
    expect(parseNiteCell("EXPL", "分類できない").status).toBe("CANNOT_CLASSIFY");
    expect(parseNiteCell("FLAM_LIQ", "分類できない［但し、区分3または区分4］").status).toBe(
      "CANNOT_CLASSIFY",
    );
  });

  it("区分と H コード（全角の数字・空白も）", () => {
    const p = parseNiteCell("ACUTE_TOX_ORAL", "区分４");
    expect(p.status).toBe("CLASSIFIED");
    expect(p.items).toEqual([
      { hazardClass: "ACUTE_TOX_ORAL", category: "4", targetOrgans: undefined, hCodes: ["H302"] },
    ]);
    expect(parseNiteCell("SKIN_CORR_IRRIT", "区分1A").items[0]).toMatchObject({
      category: "1A",
      hCodes: ["H314"],
    });
    expect(parseNiteCell("CARC", "区分1B").items[0]).toMatchObject({
      category: "1B",
      hCodes: ["H350"],
    });
  });

  it("標的臓器つきの STOT。括弧の入れ子と、区分の併記", () => {
    const p = parseNiteCell(
      "STOT_RE",
      "区分1 （血液系、中枢神経系、感覚器（聴覚））、区分2 （肝臓）",
    );
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toMatchObject({
      category: "1",
      targetOrgans: "血液系、中枢神経系、感覚器(聴覚)",
      hCodes: ["H372"],
    });
    expect(p.items[1]).toMatchObject({ category: "2", targetOrgans: "肝臓", hCodes: ["H373"] });
  });

  it("STOT 単回 区分 3 の H は標的臓器で決まる", () => {
    expect(parseNiteCell("STOT_SE", "区分3（気道刺激性）").items[0]!.hCodes).toEqual(["H335"]);
    expect(parseNiteCell("STOT_SE", "区分3（麻酔作用）").items[0]!.hCodes).toEqual(["H336"]);
    expect(parseNiteCell("STOT_SE", "区分3（気道刺激性、麻酔作用）").items[0]!.hCodes).toEqual([
      "H335",
      "H336",
    ]);
    expect(
      parseNiteCell("STOT_SE", "区分1（呼吸器）、区分3（麻酔作用）").items.map((i) => i.category),
    ).toEqual(["1", "3"]);
  });

  it("爆発物の等級・不安定爆発物、自己反応性のタイプ、高圧ガスの呼び方", () => {
    expect(parseNiteCell("EXPL", "等級1.1").items[0]).toMatchObject({
      category: "1.1",
      hCodes: ["H201"],
    });
    expect(parseNiteCell("EXPL", "不安定爆発物").items[0]).toMatchObject({
      category: "UNSTABLE",
      hCodes: ["H200"],
    });
    expect(parseNiteCell("SELF_REACT", "タイプG").items[0]).toMatchObject({
      category: "G",
      hCodes: [],
    });
    expect(parseNiteCell("ORG_PEROX", "タイプB").items[0]).toMatchObject({
      category: "B",
      hCodes: ["H241"],
    });
    expect(parseNiteCell("PRESS_GAS", "液化ガス").items[0]).toMatchObject({
      category: "LIQUEFIED",
      hCodes: ["H280"],
    });
    expect(parseNiteCell("PRESS_GAS", "低圧液化ガス").items[0]).toMatchObject({
      category: "LIQUEFIED",
    });
    expect(parseNiteCell("PRESS_GAS", "溶解ガス").items[0]).toMatchObject({
      category: "DISSOLVED",
    });
  });

  it("1 セルから 2 つのクラス・区分が出るもの", () => {
    const gas = parseNiteCell("FLAM_GAS", "区分1、化学的に不安定なガス区分B");
    expect(gas.items).toEqual([
      { hazardClass: "FLAM_GAS", category: "1", targetOrgans: undefined, hCodes: ["H220"] },
      { hazardClass: "CHEM_UNST_GAS", category: "B", hCodes: ["H231"] },
    ]);
    expect(parseNiteCell("FLAM_GAS", "区分1、B").items[1]).toMatchObject({
      hazardClass: "CHEM_UNST_GAS",
      category: "B",
    });
    const repr = parseNiteCell(
      "REPR",
      "区分1B、授乳に対するまたは授乳を介した影響に関する追加区分",
    );
    expect(repr.items.map((i) => [i.category, i.hCodes[0]])).toEqual([
      ["1B", "H360"],
      ["LACT", "H362"],
    ]);
    expect(
      parseNiteCell("REPR", "区分1A、追加区分：授乳に対するまたは授乳を介した影響").items[1]!
        .category,
    ).toBe("LACT");
  });

  it("読めない文字列は捨てずに unknown に残す", () => {
    const p = parseNiteCell("FLAM_LIQ", "区分2、なにか新しい書き方");
    expect(p.status).toBe("CLASSIFIED");
    expect(p.items).toHaveLength(1);
    expect(p.unknown).toBe("なにか新しい書き方");
    const q = parseNiteCell("FLAM_LIQ", "まったく読めない");
    expect(q.status).toBe("NOT_EVALUATED");
    expect(q.unknown).toBe("まったく読めない");
  });
});

describe("splitTopLevel", () => {
  it("括弧の中の読点では切らない", () => {
    expect(splitTopLevel("区分1(神経系、呼吸器)、区分3(麻酔作用)")).toEqual([
      "区分1(神経系、呼吸器)",
      "区分3(麻酔作用)",
    ]);
    expect(splitTopLevel("区分1(感覚器(聴覚)、肝臓)")).toEqual(["区分1(感覚器(聴覚)、肝臓)"]);
  });
});

describe("revisionOfGuidance", () => {
  it("ガイダンスの文字から改訂版を取り出す", () => {
    expect(revisionOfGuidance("ガイダンスVer.2.1 (GHS 6版, JIS Z7252:2019)")).toBe("6");
    expect(revisionOfGuidance("ガイダンス（H22.7版） （GHS 3版, JIS Z 7252:2009）")).toBe("3");
    expect(revisionOfGuidance("マニュアル（H18.2.10版）(GHS 初版)")).toBe("1");
    expect(revisionOfGuidance("")).toBeUndefined();
  });
});

describe("splitCas", () => {
  it("1 セルに並んだ CAS を分け、CAS の形でないものは invalid に残す", () => {
    expect(splitCas("10326-41-7, 50-21-5, 598-82-3, 79-33-4").cas.map((c) => c.normalized)).toEqual(
      ["10326-41-7", "50-21-5", "598-82-3", "79-33-4"],
    );
    expect(splitCas("７６６４－９３－９").cas[0]!.normalized).toBe("7664-93-9");
    expect(splitCas("")).toEqual({ cas: [], invalid: [] });
    expect(splitCas("-")).toEqual({ cas: [], invalid: [] });
    expect(splitCas("1234-56-7, abc")).toEqual({
      cas: [{ raw: "1234-56-7", normalized: "1234-56-7" }],
      invalid: ["abc"],
    });
  });
});
