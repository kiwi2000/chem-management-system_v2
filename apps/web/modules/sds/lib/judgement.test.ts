import { describe, expect, it } from "vitest";
import type { AdoptedCell } from "@/lib/ghs/adopt";
import { applyAdoptedCells, mixtureFromInputs } from "./judgement";

/** 成分の採用結果 → ルール言語の区分・未知・該当しない（S27 §5 の 4） */
function cell(
  hazardClass: string,
  status: AdoptedCell["status"],
  categories: string[] = [],
  from: string | null = "NITE",
): AdoptedCell {
  return {
    hazardClass,
    status,
    items: categories.map((category) => ({ category, targetOrgans: null, hCodes: null })),
    from,
    via: null,
  };
}

function target() {
  return {
    categories: new Map<string, string>(),
    unknown: new Set<string>(),
    noHazard: new Set<string>(),
    from: new Map<string, string>(),
  };
}

describe("applyAdoptedCells", () => {
  it("該当は区分、該当しない・対象外は noHazard、分類できない・未評価は未知", () => {
    const t = target();
    applyAdoptedCells(t, [
      cell("ACUTE_TOX_ORAL", "CLASSIFIED", ["3"]),
      cell("SKIN_CORR_IRRIT", "NOT_CLASSIFIED"),
      cell("EYE_DAM_IRRIT", "NOT_APPLICABLE"),
      cell("CARC", "CANNOT_CLASSIFY"),
      cell("MUTA", "NOT_EVALUATED", [], null),
    ]);
    expect(t.categories.get("acute.oral")).toBe("3");
    expect([...t.noHazard].sort()).toEqual(["eye", "skin"]);
    expect([...t.unknown].sort()).toEqual(["carc", "muta"]);
    expect(t.from.get("acute.oral")).toBe("NITE");
    expect(t.from.has("muta")).toBe(false);
  });

  it("区分が複数あれば最も重いもの（カタログの並び）", () => {
    const t = target();
    applyAdoptedCells(t, [cell("STOT_SE", "CLASSIFIED", ["3", "1"])]);
    expect(t.categories.get("stot_se")).toBe("1");
  });

  it("生殖毒性の授乳影響は別のクラス lactation に。授乳だけなら repr は該当しない", () => {
    const t = target();
    applyAdoptedCells(t, [cell("REPR", "CLASSIFIED", ["LACT"])]);
    expect(t.categories.get("lactation")).toBe("additional");
    expect(t.categories.has("repr")).toBe(false);
    expect(t.noHazard.has("repr")).toBe(true);

    const u = target();
    applyAdoptedCells(u, [cell("REPR", "CLASSIFIED", ["1B", "LACT"])]);
    expect(u.categories.get("repr")).toBe("1B");
    expect(u.categories.get("lactation")).toBe("additional");
  });

  it("経路なしの吸入は、経路ありが無いクラスにだけ配る", () => {
    const t = target();
    applyAdoptedCells(t, [
      cell("ACUTE_TOX_INHAL", "CLASSIFIED", ["2"]),
      cell("ACUTE_TOX_INHAL_VAPOUR", "CLASSIFIED", ["4"]),
    ]);
    expect(t.categories.get("acute.vapour")).toBe("4");
    expect(t.categories.get("acute.gas")).toBe("2");
    expect(t.categories.get("acute.dust")).toBe("2");
  });

  it("経路なしの吸入が未評価なら、経路ごとのクラスを未知にしない", () => {
    const t = target();
    applyAdoptedCells(t, [cell("ACUTE_TOX_INHAL", "NOT_EVALUATED", [], null)]);
    expect(t.unknown.size).toBe(0);
  });
});

describe("mixtureFromInputs", () => {
  it("保存した写しから処理系の形を作る（含有率は数値、集合は Set）", () => {
    const m = mixtureFromInputs({
      ingredients: [
        {
          substanceId: "s1",
          code: "SB-1",
          nameJa: "物質A",
          nameEn: null,
          cas: "64-17-5",
          pct: "12.5",
          categories: { "acute.oral": "4" },
          unknown: ["carc"],
          noHazard: ["skin"],
          values: { "ate.oral": 500 },
          flags: ["relevant"],
          from: {},
        },
      ],
      product: { physical_state: "liquid", ph: 3 },
      blocked: [],
    });
    const a = m.ingredients[0]!;
    expect(a.name).toBe("物質A");
    expect(a.conc).toBe(12.5);
    expect(a.categories.get("acute.oral")).toBe("4");
    expect(a.unknown.has("carc")).toBe(true);
    expect(a.noHazard?.has("skin")).toBe(true);
    expect(a.values.get("ate.oral")).toBe(500);
    expect(a.flags.has("relevant")).toBe(true);
    expect(m.product.get("ph")).toBe(3);
  });
});
