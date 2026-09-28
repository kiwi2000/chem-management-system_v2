import { describe, expect, it, vi } from "vitest";

// 純粋な組み立て（adoptFor）だけを見る。DB には触らない
vi.mock("@/lib/db", () => ({ prisma: {} }));

const { adoptFor, defaultRules } = await import("./adopt");
type SourceRow = import("./adopt").SourceRow;

const rules = [
  { sourceCode: "NITE", priority: 1, fillCannotClassify: false },
  { sourceCode: "EU_ANNEX_VI", priority: 2, fillCannotClassify: false },
];
type Status = SourceRow["status"];
const row = (
  sourceCode: string,
  hazardClass: string,
  status: Status,
  category = "",
  link: Partial<
    Pick<
      SourceRow,
      "entryKey" | "entryName" | "linkOrigin" | "linkedBy" | "linkNote" | "conditionText"
    >
  > = {},
): SourceRow => ({
  sourceCode,
  entryKey: link.entryKey ?? `${sourceCode}-1`,
  entryName: link.entryName ?? "x",
  hazardClass,
  category,
  status,
  targetOrgans: null,
  hCodes: null,
  linkOrigin: link.linkOrigin ?? "SOURCE",
  linkedBy: link.linkedBy ?? null,
  linkNote: link.linkNote ?? null,
  conditionText: link.conditionText ?? null,
});
const cellOf = (cells: ReturnType<typeof adoptFor>, cls: string) =>
  cells.find((c) => c.hazardClass === cls)!;
/** LOLI の展開で親の項目に結んだ行 */
const viaLoli = (entryKey: string, entryName: string) => ({
  entryKey,
  entryName,
  linkOrigin: "EXPANSION" as const,
  linkedBy: "LOLI",
  linkNote: `As ${entryName} [RR-1]`,
});

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
    expect(cell.via?.linkedBy).toBeNull();
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
    expect(cell.via).toBeNull();
  });

  it("既定の採用順は、その国の出典が先頭。結び付きだけのデータ種（LOLI）は並ばない", () => {
    expect(defaultRules("EU").map((r) => r.sourceCode)).toEqual(["EU_ANNEX_VI", "NITE"]);
    expect(defaultRules("JP").map((r) => r.sourceCode)).toEqual(["NITE", "EU_ANNEX_VI"]);
    expect(defaultRules("KR").map((r) => r.sourceCode)).toEqual(["NITE", "EU_ANNEX_VI"]);
  });
});

describe("adoptFor（§9-4 結び付きの層）", () => {
  it("同じ出典では、原典に直接載っている結び付きを LOLI の展開より先に見る（総称の「別掲のものを除く」）", () => {
    const rows = [
      row("EU_ANNEX_VI", "REPR", "CLASSIFIED", "1A", viaLoli("082-001-00-6", "lead compounds")),
      row("EU_ANNEX_VI", "REPR", "CLASSIFIED", "2", {
        entryKey: "082-002-00-1",
        entryName: "lead alkyls",
      }),
    ];
    const cell = cellOf(adoptFor(rules, rows, [], "EU"), "REPR");
    expect(cell.items.map((i) => i.category)).toEqual(["2"]);
    expect(cell.via?.linkedBy).toBeNull();
    expect(cell.via?.entryKey).toBe("082-002-00-1");
  });

  it("LOLI の展開だけで当たるときはそれを採り、来かたに LOLI と親の項目が付く", () => {
    const rows = [
      row("EU_ANNEX_VI", "REPR", "CLASSIFIED", "1A", viaLoli("082-001-00-6", "lead compounds")),
    ];
    const cell = cellOf(adoptFor(rules, rows, [], "EU"), "REPR");
    expect(cell.from).toBe("EU_ANNEX_VI");
    expect(cell.items.map((i) => i.category)).toEqual(["1A"]);
    expect(cell.via).toMatchObject({
      linkedBy: "LOLI",
      entryKey: "082-001-00-6",
      entryName: "lead compounds",
    });
  });

  it("1 つの CAS が複数の総称に当たるときは、クラスごとに厳しいほうの区分を採る", () => {
    const rows = [
      row("EU_ANNEX_VI", "ACUTE_TOX_ORAL", "CLASSIFIED", "4", viaLoli("A", "compounds A")),
      row("EU_ANNEX_VI", "ACUTE_TOX_ORAL", "CLASSIFIED", "3", viaLoli("B", "compounds B")),
      row("EU_ANNEX_VI", "AQUATIC_CHRONIC", "CLASSIFIED", "1", viaLoli("A", "compounds A")),
      row("EU_ANNEX_VI", "AQUATIC_CHRONIC", "NOT_CLASSIFIED", "", viaLoli("B", "compounds B")),
    ];
    const cells = adoptFor(rules, rows, [], "EU");
    const oral = cellOf(cells, "ACUTE_TOX_ORAL");
    expect(oral.items.map((i) => i.category)).toEqual(["3"]);
    expect(oral.via?.entryKey).toBe("B");
    const chronic = cellOf(cells, "AQUATIC_CHRONIC");
    expect(chronic.items.map((i) => i.category)).toEqual(["1"]);
    expect(chronic.via?.entryKey).toBe("A");
  });

  it("該当と該当以外が混じる項目では該当を、該当が無ければ「区分に該当しない」を「分類できない」より先に採る", () => {
    const rows = [
      row("NITE", "CARC", "CANNOT_CLASSIFY", "", { entryKey: "n1" }),
      row("NITE", "CARC", "NOT_CLASSIFIED", "", { entryKey: "n2" }),
    ];
    const cell = cellOf(adoptFor(rules, rows, [], "JP"), "CARC");
    expect(cell.status).toBe("NOT_CLASSIFIED");
    expect(cell.via?.entryKey).toBe("n2");
  });
});

describe("adoptFor（§9-5 適用条件）", () => {
  it("無条件の項目があればそれを採り、条件付きの項目は要確認として添える", () => {
    const rows = [
      row("EU_ANNEX_VI", "ACUTE_TOX_ORAL", "CLASSIFIED", "2", {
        entryKey: "006-006-00-X",
        entryName: "HCN",
      }),
      row("EU_ANNEX_VI", "ACUTE_TOX_ORAL", "CLASSIFIED", "3", {
        entryKey: "006-006-01-6",
        entryName: "HCN …%",
        conditionText: "…%",
      }),
    ];
    const cell = cellOf(adoptFor(rules, rows, [], "EU"), "ACUTE_TOX_ORAL");
    expect(cell.items.map((i) => i.category)).toEqual(["2"]);
    expect(cell.via?.entryKey).toBe("006-006-00-X");
    expect(cell.review).toEqual([
      { entryKey: "006-006-01-6", entryName: "HCN …%", condition: "…%" },
    ]);
  });

  it("条件付きの項目しか無ければ厳しいほうを採り、全部を要確認に並べる", () => {
    const rows = [
      row("NITE", "SKIN_CORR_IRRIT", "CLASSIFIED", "2", {
        entryKey: "n-a",
        entryName: "粉",
        conditionText: "粉体",
      }),
      row("NITE", "SKIN_CORR_IRRIT", "CLASSIFIED", "1", {
        entryKey: "n-b",
        entryName: "液",
        conditionText: "液体",
      }),
    ];
    const cell = cellOf(adoptFor(rules, rows, [], "JP"), "SKIN_CORR_IRRIT");
    expect(cell.items.map((i) => i.category)).toEqual(["1"]);
    expect(cell.review?.map((r) => r.entryKey).sort()).toEqual(["n-a", "n-b"]);
  });

  it("条件の無い項目だけなら要確認は付かない", () => {
    const cell = cellOf(
      adoptFor(rules, [row("NITE", "CARC", "CLASSIFIED", "2")], [], "JP"),
      "CARC",
    );
    expect(cell.review).toBeUndefined();
  });
});
