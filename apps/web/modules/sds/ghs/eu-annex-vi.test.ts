import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  parseEuClassToken,
  parseEuClassifications,
  readEuAnnexVi,
  splitEuCas,
} from "./eu-annex-vi";

/** ECHA の Excel（History シート）の書き方。実データで見つかった形を網羅する */
describe("parseEuClassToken", () => {
  it("略号と区分、最小分類の印", () => {
    expect(parseEuClassToken("Acute Tox. 4 *")).toMatchObject({
      hazardClass: "ACUTE_TOX",
      category: "4",
      marks: "*",
    });
    expect(parseEuClassToken("Skin Corr. 1A")).toMatchObject({
      hazardClass: "SKIN_CORR_IRRIT",
      category: "1A",
    });
    expect(parseEuClassToken("Skin Irrit. 2")).toMatchObject({
      hazardClass: "SKIN_CORR_IRRIT",
      category: "2",
    });
    expect(parseEuClassToken("Eye Dam. 1")).toMatchObject({
      hazardClass: "EYE_DAM_IRRIT",
      category: "1",
    });
    expect(parseEuClassToken("STOT SE 3")).toMatchObject({ hazardClass: "STOT_SE", category: "3" });
    expect(parseEuClassToken("Expl. 1.1")).toMatchObject({ hazardClass: "EXPL", category: "1.1" });
    expect(parseEuClassToken("Expl.")).toMatchObject({ hazardClass: "EXPL", category: "UNSPEC" });
    expect(parseEuClassToken("Unst. Expl.")).toMatchObject({
      hazardClass: "EXPL",
      category: "UNSTABLE",
    });
    expect(parseEuClassToken("Press. Gas")).toMatchObject({
      hazardClass: "PRESS_GAS",
      category: "UNSPEC",
    });
    expect(parseEuClassToken("Lact.")).toMatchObject({ hazardClass: "REPR", category: "LACT" });
    expect(parseEuClassToken("Ozone")).toMatchObject({ hazardClass: "OZONE", category: "1" });
    expect(parseEuClassToken("Org. Perox. D")).toMatchObject({
      hazardClass: "ORG_PEROX",
      category: "D",
    });
    expect(parseEuClassToken("Flam. Gas 1A")).toMatchObject({
      hazardClass: "FLAM_GAS",
      category: "1A",
    });
  });

  it("官報の表記揺れを吸収する", () => {
    expect(parseEuClassToken("Skin. Corr. 1B")).toMatchObject({
      hazardClass: "SKIN_CORR_IRRIT",
      category: "1B",
    });
    expect(parseEuClassToken("Muta 2")).toMatchObject({ hazardClass: "MUTA", category: "2" });
    expect(parseEuClassToken("Carc. 1a")).toMatchObject({ hazardClass: "CARC", category: "1A" });
    expect(parseEuClassToken("Carc. 1Β")).toMatchObject({ hazardClass: "CARC", category: "1B" }); // ギリシャ文字
    expect(parseEuClassToken("Flam. Gas. 1")).toMatchObject({
      hazardClass: "FLAM_GAS",
      category: "1",
    });
    expect(parseEuClassToken("Self-heat 1")).toMatchObject({
      hazardClass: "SELF_HEAT",
      category: "1",
    });
    expect(parseEuClassToken("Unst. Expl")).toMatchObject({
      hazardClass: "EXPL",
      category: "UNSTABLE",
    });
    expect(parseEuClassToken("なにか")).toBeNull();
  });
});

describe("parseEuClassifications", () => {
  it("急性毒性の経路は H コードで決め、H は候補で拾う（行の対応がずれていても）", () => {
    const r = parseEuClassifications(
      "Acute Tox. 3 *\nAcute Tox. 4 *\nSTOT RE 2 *\nAquatic Chronic 2",
      "H331\nH302\nH373 **\nH411",
    );
    expect(r.issues).toEqual([]);
    expect(
      r.classifications.map((c) => [
        c.hazardClass,
        c.category,
        c.hCodes[0],
        c.minimumClassification,
        c.hCodesOrigin,
      ]),
    ).toEqual([
      ["ACUTE_TOX_INHAL", "3", "H331", "*", "SOURCE"],
      ["ACUTE_TOX_ORAL", "4", "H302", "*", "SOURCE"],
      ["STOT_RE", "2", "H373", "*", "SOURCE"],
      ["AQUATIC_CHRONIC", "2", "H411", undefined, "SOURCE"],
    ]);
  });

  it("生殖毒性の派生形の H、複数の H が 1 行に並ぶとき、H が無いときはカタログから", () => {
    const r = parseEuClassifications(
      "Repr. 1B\nSTOT RE 1\nCarc. 1A\nSkin Sens. 1",
      "H360D*** H372**\nH350i",
    );
    expect(
      r.classifications.map((c) => [
        c.hazardClass,
        c.hCodes[0],
        c.hCodesOrigin,
        c.minimumClassification,
      ]),
    ).toEqual([
      ["REPR", "H360D", "SOURCE", "***"],
      ["STOT_RE", "H372", "SOURCE", "**"],
      ["CARC", "H350i", "SOURCE", undefined],
      ["SKIN_SENS", "H317", "CATALOG", undefined],
    ]);
  });

  it("読めない行は要確認に残し、ほかは読む", () => {
    const r = parseEuClassifications("Flam. Liq. 2\nなにか", "H225");
    expect(r.classifications).toHaveLength(1);
    expect(r.issues).toEqual(["クラスの表記が読めない: なにか"]);
  });
});

describe("splitEuCas", () => {
  it("[1] [2] の並記を分け、無いものは空", () => {
    expect(splitEuCas("10043-35-3 [1]\n11113-50-1 [2]").cas.map((c) => c.normalized)).toEqual([
      "10043-35-3",
      "11113-50-1",
    ]);
    expect(splitEuCas("—")).toEqual({ cas: [], invalid: [] });
    expect(splitEuCas("7664-93-9")).toEqual({
      cas: [{ raw: "7664-93-9", normalized: "7664-93-9" }],
      invalid: [],
    });
  });
});

/** History シートと同じ形の小さな Excel を組んで、版の選び方を確かめる */
async function workbookOf(rows: (string | Date)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("History_"); // ExcelJS は "History" という名前を予約している。読み手は名前に history を含むシートも探す
  ws.addRow([
    "Index No",
    "ATP",
    "CELEX",
    "Chemical Name",
    "EC No",
    "CAS No",
    "Hazard Class and Category Code(s)",
    "Classification Hazard Statement Code(s)",
    "Labelling Pictogram, Signal Word Code(s)",
    "Labelling Hazard Statement Code(s)",
    "Labelling Suppl. Hazard Statement Code(s)",
    "M, SCL, ATE",
    "Notes",
    "Comment",
    "In application",
    "EUR-Lex Link",
  ]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("readEuAnnexVi", () => {
  it("いま効いている版と将来の版を出し、過去の版は出さない。削除は前の版を閉じる", async () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const buf = await workbookOf([
      // 015-012-00-1: 2010 の版（いま）と 2027 の版（将来）
      [
        "015-012-00-1",
        "CLP00",
        "32008R1272",
        "tetraphosphorus trisulphide",
        "215-245-0",
        "1314-85-8",
        "Flam. Sol. 2\nWater-react. 1\nAcute Tox. 4 *",
        "H228\nH260\nH302",
        "GHS02\nGHS07\nDgr",
        "H228\nH260\nH302",
        "",
        "",
        "T",
        "",
        d("2010-12-01"),
        "",
      ],
      [
        "015-012-00-1",
        "ATP23",
        "32025R1222",
        "tetraphosphorus trisulphide",
        "215-245-0",
        "1314-85-8",
        "Flam. Sol. 1\nSelf-heat. 1\nAcute Tox. 4 *",
        "H228\nH251\nH302",
        "GHS02\nGHS07\nDgr",
        "H228\nH251\nH302",
        "",
        "",
        "T",
        "",
        d("2027-02-01"),
        "",
      ],
      // 001-002-00-4: 2010 の版は過去、2012 の版がいま
      [
        "001-002-00-4",
        "CLP00",
        "32008R1272",
        "aluminium lithium hydride",
        "240-877-9",
        "16853-85-3",
        "Water-react. 1",
        "H260",
        "GHS02\nDgr",
        "H260",
        "",
        "",
        "",
        "",
        d("2010-12-01"),
        "",
      ],
      [
        "001-002-00-4",
        "ATP01",
        "32009R0790",
        "aluminium lithium hydride",
        "240-877-9",
        "16853-85-3",
        "Water-react. 1\nSkin Corr. 1A",
        "H260\nH314",
        "GHS02\nGHS05\nDgr",
        "H260\nH314",
        "",
        "",
        "",
        "",
        d("2012-12-01"),
        "",
      ],
      // 022-006-00-2: 2020 に入り、2025 に削除
      [
        "022-006-00-2",
        "ATP14",
        "32020R0217",
        "titanium dioxide",
        "236-675-5",
        "13463-67-7",
        "Carc. 2",
        "H351",
        "GHS08\nWng",
        "H351",
        "",
        "",
        "V W 10",
        "",
        d("2021-10-01"),
        "",
      ],
      [
        "022-006-00-2",
        "ATP21",
        "32024R2564",
        "titanium dioxide",
        "236-675-5",
        "13463-67-7",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "Index # deleted",
        d("2025-09-01"),
        "",
      ],
    ]);
    const r = await readEuAnnexVi(buf, "2026-09-28");
    expect(r.issues).toEqual([]);
    const by = (k: string) => r.entries.filter((e) => e.sourceKey === k);
    expect(
      by("015-012-00-1").map((e) => [
        e.effectiveFrom,
        e.effectiveTo,
        e.classifications.map((c) => c.rawClassText),
      ]),
    ).toEqual([
      ["2010-12-01", "2027-01-31", ["Flam. Sol. 2", "Water-react. 1", "Acute Tox. 4 *"]],
      ["2027-02-01", undefined, ["Flam. Sol. 1", "Self-heat. 1", "Acute Tox. 4 *"]],
    ]);
    expect(by("001-002-00-4").map((e) => [e.effectiveFrom, e.effectiveTo, e.amendingAct])).toEqual([
      ["2012-12-01", undefined, "ATP01 32009R0790"],
    ]);
    expect(by("022-006-00-2")).toEqual([]); // 削除済み
    const t = by("015-012-00-1")[0]!;
    expect(t.cas).toEqual([{ raw: "1314-85-8", normalized: "1314-85-8" }]);
    expect(t.ecNumber).toBe("215-245-0");
    expect(t.notesRaw).toBe("T");
    expect(t.classifications[2]).toMatchObject({
      hazardClass: "ACUTE_TOX_ORAL",
      category: "4",
      hCodes: ["H302"],
      minimumClassification: "*",
      classifiedIn: "CLP00",
    });
  });

  it("削除が将来なら、いまの版に終了日を付ける", async () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const buf = await workbookOf([
      [
        "999-001-00-0",
        "CLP00",
        "32008R1272",
        "x",
        "",
        "50-00-0",
        "Carc. 2",
        "H351",
        "",
        "",
        "",
        "",
        "",
        "",
        d("2010-12-01"),
        "",
      ],
      [
        "999-001-00-0",
        "ATP99",
        "32099R0001",
        "x",
        "",
        "50-00-0",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "Index # deleted",
        d("2030-01-01"),
        "",
      ],
    ]);
    const r = await readEuAnnexVi(buf, "2026-09-28");
    expect(r.entries.map((e) => [e.effectiveFrom, e.effectiveTo])).toEqual([
      ["2010-12-01", "2029-12-31"],
    ]);
  });
});
