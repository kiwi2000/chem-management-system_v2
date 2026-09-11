import { describe, expect, it } from "vitest";
import { compare } from "./compare";
import type { CategorySnap, LinkSnap, Snapshot, SubstanceSnap } from "./snapshot";

/** 小さな写しを組み立てる道具 */
function link(cas: string, extra: Partial<LinkSnap> = {}): LinkSnap {
  return {
    version: "2026Q3",
    source: "LOLI",
    cas,
    casNumber: cas,
    excluded: false,
    note: null,
    text: null,
    textJa: null,
    ...extra,
  };
}

function substance(code: string, extra: Partial<SubstanceSnap> = {}): SubstanceSnap {
  return {
    code,
    officialNumber: "1",
    nameOriginal: `物質 ${code}`,
    nameLang: "JA",
    nameJa: null,
    nameEn: null,
    displayOrder: 1,
    thresholdLower: "1",
    lowerBound: "EXCLUSIVE",
    thresholdUpper: "100",
    upperBound: "INCLUSIVE",
    aggregation: "NONE",
    metalEtc: null,
    effectiveFrom: null,
    effectiveTo: null,
    applicableCondition: null,
    note: null,
    links: [link("50-00-0")],
    ...extra,
  };
}

function category(
  code: string,
  subs: SubstanceSnap[],
  extra: Partial<CategorySnap> = {},
): CategorySnap {
  return {
    code,
    nameOriginal: `区分 ${code}`,
    nameLang: "JA",
    nameJa: null,
    nameEn: null,
    displayOrder: 1,
    thresholdLower: "1",
    lowerBound: "EXCLUSIVE",
    thresholdUpper: "100",
    upperBound: "INCLUSIVE",
    aggregation: "NONE",
    metalEtc: null,
    thresholdBasis: "PRODUCT",
    judged: true,
    effectiveFrom: null,
    effectiveTo: null,
    interactionGroup: null,
    rank: null,
    score: "0",
    note: null,
    classes: [
      {
        code: "DEFAULT",
        nameOriginal: null,
        nameLang: null,
        nameJa: null,
        nameEn: null,
        displayOrder: 0,
        interactionGroup: null,
        rank: null,
        note: null,
        substances: subs,
      },
    ],
    ...extra,
  };
}

function snapshot(label: string, cats: CategorySnap[]): Snapshot {
  return {
    format: "chem-precheck/1",
    takenAt: "2026-09-11T00:00:00.000Z",
    label,
    versions: [{ code: "2026Q3", asOf: "2026-07-01", isCurrent: true }],
    sources: [{ code: "LOLI" }],
    laws: [
      {
        code: "JP-TEST",
        countryCode: "JP",
        nameOriginal: "試験法",
        nameLang: "JA",
        nameJa: null,
        nameEn: null,
        displayOrder: 1,
        note: null,
        categories: cats,
      },
    ],
  };
}

describe("compare", () => {
  it("名前だけ変えたものは表示だけ・残す", () => {
    const base = snapshot("base", [category("A", [substance("S1")])]);
    const customer = snapshot("customer", [
      category("A", [substance("S1", { nameJa: "ホルムアルデヒド" })]),
    ]);
    const next = snapshot("next", [
      category("A", [substance("S1", { nameJa: "ホルムアルデヒド（配布）" })]),
    ]);
    const r = compare(customer, base, next);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.field).toBe("nameJa");
    expect(f.impact).toBe("display");
    expect(f.conflict).toBe("conflict");
    expect(f.proposal).toBe("keep");
  });

  it("閾値を変えて配布物ともぶつかるなら要相談、ぶつからなければ残す（確認）", () => {
    const base = snapshot("base", [category("A", [substance("S1")])]);
    const customer = snapshot("customer", [
      category("A", [substance("S1", { thresholdLower: "0.1" })]),
    ]);
    const bump = compare(
      customer,
      base,
      snapshot("next", [category("A", [substance("S1", { thresholdLower: "5" })])]),
    );
    expect(bump.findings[0]?.impact).toBe("judgement");
    expect(bump.findings[0]?.proposal).toBe("discuss");
    const same = compare(
      customer,
      base,
      snapshot("next", [category("A", [substance("S1", { thresholdLower: "0.1" })])]),
    );
    expect(same.findings[0]?.conflict).toBe("agree");
    expect(same.findings[0]?.proposal).toBe("keep-check");
    const none = compare(customer, base, null);
    expect(none.findings[0]?.conflict).toBe("n/a");
    expect(none.findings[0]?.proposal).toBe("keep-check");
  });

  it("顧客が足した結び付きは残す、非該当にしたものは判定が変わる", () => {
    const base = snapshot("base", [category("A", [substance("S1")])]);
    const customer = snapshot("customer", [
      category("A", [
        substance("S1", { links: [link("50-00-0", { excluded: true }), link("64-17-5")] }),
      ]),
    ]);
    const r = compare(customer, base, null);
    const added = r.findings.find((f) => f.change === "added");
    expect(added?.kind).toBe("link");
    expect(added?.proposal).toBe("keep");
    const excluded = r.findings.find((f) => f.field === "excluded");
    expect(excluded?.impact).toBe("judgement");
  });

  it("消した行は鍵の変更。配布物がまだ持っていれば要相談、無ければ残す", () => {
    const base = snapshot("base", [category("A", [substance("S1"), substance("S2")])]);
    const customer = snapshot("customer", [category("A", [substance("S1")])]);
    const back = compare(
      customer,
      base,
      snapshot("next", [category("A", [substance("S1"), substance("S2")])]),
    );
    const f = back.findings[0]!;
    expect(f.change).toBe("removed");
    expect(f.impact).toBe("key");
    expect(f.proposal).toBe("discuss");
    expect(f.remark).toContain("戻る");
    const gone = compare(customer, base, snapshot("next", [category("A", [substance("S1")])]));
    expect(gone.findings[0]?.proposal).toBe("keep");
  });

  it("別の分類へ付け替えた行は付け替えとして出す", () => {
    const baseCat = category("A", [substance("S1")]);
    const customerCat = category("A", []);
    customerCat.classes.push({
      ...baseCat.classes[0]!,
      code: "OTHER",
      substances: [substance("S1")],
    });
    const r = compare(snapshot("customer", [customerCat]), snapshot("base", [baseCat]), null);
    const moved = r.findings.find((f) => f.change === "moved");
    expect(moved?.customer).toBe("OTHER");
    expect(moved?.base).toBe("DEFAULT");
    expect(moved?.proposal).toBe("discuss");
    expect(r.findings.filter((f) => f.change === "removed")).toHaveLength(0);
  });

  it("同じ名前で別コードに変えたものは、コードの付け替えの疑いとして要相談", () => {
    const base = snapshot("base", [category("A", [substance("S1", { nameOriginal: "トルエン" })])]);
    const customer = snapshot("customer", [
      category("A", [substance("S9", { nameOriginal: "トルエン" })]),
    ]);
    const r = compare(customer, base, null);
    expect(r.findings.every((f) => f.proposal === "discuss")).toBe(true);
    expect(r.findings.some((f) => f.remark.includes("付け替えの疑い"))).toBe(true);
  });

  it("まとめの件数は影響×扱いで数える", () => {
    const base = snapshot("base", [category("A", [substance("S1")])]);
    const customer = snapshot("customer", [
      category("A", [substance("S1", { nameJa: "名前", thresholdUpper: "50" })], { judged: false }),
    ]);
    const r = compare(customer, base, null);
    expect(r.summary.total).toBe(3);
    expect(r.summary.counts.display.keep).toBe(1);
    expect(r.summary.counts.judgement["keep-check"]).toBe(2);
    expect(r.findings[0]?.proposal).toBe("keep-check");
  });
});
