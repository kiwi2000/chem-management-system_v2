import { emptyTableState } from "@chem/shared";
import { describe, expect, it } from "vitest";
import { pageSummaryRows } from "./prtr-summary-table";
import type { PrtrSummaryRowDto } from "./types";

const row = (n: number, over: Partial<PrtrSummaryRowDto> = {}): PrtrSummaryRowDto => ({
  statutorySubstanceId: `s${n}`,
  officialNumber: `令別表第1の${n}`,
  nameJa: null,
  nameEn: null,
  nameOriginal: `物質${n}`,
  specific: false,
  handledKg: String(n * 100),
  shippedKg: String(n * 10),
  releaseKg: String(n),
  needsReport: n >= 10,
  productCount: n,
  ...over,
});

describe("pageSummaryRows", () => {
  const rows = [row(103), row(73), row(464, { specific: true }), row(7, { releaseKg: null })];

  it("番号は数として並ぶ（73 → 103）", () => {
    const state = emptyTableState([{ column: "officialNumber", direction: "asc" }]);
    expect(pageSummaryRows(rows, state).items.map((r) => r.officialNumber)).toEqual([
      "令別表第1の7",
      "令別表第1の73",
      "令別表第1の103",
      "令別表第1の464",
    ]);
  });

  it("数の列は数として比べ、空は最後。2 列目でも並ぶ", () => {
    const state = emptyTableState([
      { column: "needsReport", direction: "desc" },
      { column: "releaseKg", direction: "desc" },
    ]);
    expect(pageSummaryRows(rows, state).items.map((r) => r.productCount)).toEqual([
      464, 103, 73, 7,
    ]);
    const asc = emptyTableState([{ column: "releaseKg", direction: "asc" }]);
    expect(pageSummaryRows(rows, asc).items.map((r) => r.productCount)).toEqual([73, 103, 464, 7]);
  });

  it("絞り込みとページ送り", () => {
    const state = {
      ...emptyTableState([{ column: "officialNumber", direction: "asc" }]),
      filters: { kind: { kind: "enum" as const, values: ["C1"] } },
      pageSize: 2,
      page: 2,
    };
    const r = pageSummaryRows(rows, state);
    expect(r.total).toBe(3);
    expect(r.items.map((x) => x.productCount)).toEqual([103]);
  });
});
