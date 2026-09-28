import { describe, expect, it, vi } from "vitest";

// 純粋な組み立て（adoptFor）だけを見る。DB には触らない
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { adoptFor, defaultRules } = await import("./adopt");

const rules = [
  { sourceCode: "NITE", priority: 1, fillCannotClassify: false },
  { sourceCode: "EU_ANNEX_VI", priority: 2, fillCannotClassify: false },
];
const row = (
  sourceCode: string,
  hazardClass: string,
  status: "CLASSIFIED" | "NOT_CLASSIFIED" | "CANNOT_CLASSIFY" | "NOT_APPLICABLE" | "NOT_EVALUATED",
  category = "",
) => ({ sourceCode, hazardClass, category, status, targetOrgans: null, hCodes: null });
const cellOf = (cells: ReturnType<typeof adoptFor>, cls: string) =>
  cells.find((c) => c.hazardClass === cls)!;

describe("adoptFor（S23 §5-3 の 1・2 段目）", () => {
  it("上書きが最優先。国指定のものが「全ての国」のものより先", () => {
    const overrides = [
      {
        hazardClass: "CARC",
        category: "2",
        status: "CLASSIFIED" as const,
        targetOrgans: null,
        hCodes: "H351",
        country: "",
        reason: "全体",
      },
      {
        hazardClass: "CARC",
        category: "1B",
        status: "CLASSIFIED" as const,
        targetOrgans: null,
        hCodes: "H350",
        country: "EU",
        reason: "EU だけ",
      },
    ];
    const rows = [row("NITE", "CARC", "NOT_CLASSIFIED")];
    const eu = cellOf(adoptFor(rules, rows, overrides, "EU"), "CARC");
    expect(eu.from).toBe("OVERRIDE");
    expect(eu.items.map((i) => i.category)).toEqual(["1B"]);
    expect(eu.reason).toBe("EU だけ");
    const jp = cellOf(adoptFor(rules, rows, overrides, "JP"), "CARC");
    expect(jp.items.map((i) => i.category)).toEqual(["2"]);
  });

  it("採用順で先の出典がそのクラスを評価していれば、区分に該当しないでもそれを採る（下位で上書きしない）", () => {
    const rows = [
      row("NITE", "SKIN_CORR_IRRIT", "NOT_CLASSIFIED"),
      row("EU_ANNEX_VI", "SKIN_CORR_IRRIT", "CLASSIFIED", "2"),
    ];
    const cell = cellOf(adoptFor(rules, rows, [], "JP"), "SKIN_CORR_IRRIT");
    expect(cell.from).toBe("NITE");
    expect(cell.status).toBe("NOT_CLASSIFIED");
    expect(cell.items).toEqual([]);
  });

  it("先の出典が見ていないクラスだけ次の出典で埋める", () => {
    const rows = [row("EU_ANNEX_VI", "FLAM_LIQ", "CLASSIFIED", "2")];
    const cell = cellOf(adoptFor(rules, rows, [], "JP"), "FLAM_LIQ");
    expect(cell.from).toBe("EU_ANNEX_VI");
    expect(cell.items.map((i) => i.category)).toEqual(["2"]);
  });

  it("「分類できない」は fillCannotClassify のときだけ次で埋め、埋まらなければそのまま残す", () => {
    const rows = [
      row("NITE", "MUTA", "CANNOT_CLASSIFY"),
      row("EU_ANNEX_VI", "MUTA", "CLASSIFIED", "2"),
    ];
    const kept = cellOf(adoptFor(rules, rows, [], "JP"), "MUTA");
    expect(kept.from).toBe("NITE");
    expect(kept.status).toBe("CANNOT_CLASSIFY");

    const filling = [{ ...rules[0]!, fillCannotClassify: true }, rules[1]!];
    const filled = cellOf(adoptFor(filling, rows, [], "JP"), "MUTA");
    expect(filled.from).toBe("EU_ANNEX_VI");
    expect(filled.items.map((i) => i.category)).toEqual(["2"]);

    const alone = cellOf(
      adoptFor(filling, [row("NITE", "MUTA", "CANNOT_CLASSIFY")], [], "JP"),
      "MUTA",
    );
    expect(alone.from).toBe("NITE");
    expect(alone.status).toBe("CANNOT_CLASSIFY");
  });

  it("どの出典にも無ければデータなし", () => {
    const cell = cellOf(adoptFor(rules, [], [], "JP"), "OZONE");
    expect(cell.status).toBe("NOT_EVALUATED");
    expect(cell.from).toBeNull();
  });

  it("既定の採用順は、その国の出典が先頭", () => {
    expect(defaultRules("EU").map((r) => r.sourceCode)).toEqual(["EU_ANNEX_VI", "NITE"]);
    expect(defaultRules("JP").map((r) => r.sourceCode)).toEqual(["NITE", "EU_ANNEX_VI"]);
    expect(defaultRules("KR").map((r) => r.sourceCode)).toEqual(["NITE", "EU_ANNEX_VI"]);
  });
});
