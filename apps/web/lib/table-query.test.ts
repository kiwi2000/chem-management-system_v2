import { normalizeCas } from "@chem/shared";
import { describe, expect, it } from "vitest";
import { buildOrderBy, buildWhere, type QueryColumn } from "./table-query";

/**
 * フィルターが Prisma の条件へ正しく変換されることを固定する。
 * 特に「正規化してから突合する」列は、ここが崩れると全角入力で検索できなくなる。
 */
const COLUMNS: QueryColumn[] = [
  { key: "casNumber", kind: "text", field: "casNormalized", normalize: normalizeCas },
  { key: "nameJa", kind: "text", field: "nameJa", caseInsensitive: true },
  { key: "status", kind: "enum", field: "status" },
  { key: "updatedAt", kind: "date", field: "updatedAt" },
  { key: "count", kind: "number", field: "count" },
  { key: "id", kind: "text", field: "id", sortable: false },
  { key: "tags", kind: "text", field: "label", relation: "tags", sortable: false },
  { key: "activeFlag", kind: "enum", field: "activeFlag", booleanEnum: true },
];

describe("buildWhere", () => {
  it("条件が無ければ空", () => {
    expect(buildWhere(COLUMNS, {})).toEqual({});
  });

  it("正規化してから突合する", () => {
    const where = buildWhere(COLUMNS, {
      casNumber: { kind: "text", op: "contains", value: "７４３９－９２－１" },
    });
    expect(where).toEqual({ AND: [{ casNormalized: { contains: "7439-92-1" } }] });
  });

  it("大文字小文字を区別しない列には mode を付ける", () => {
    expect(
      buildWhere(COLUMNS, { nameJa: { kind: "text", op: "startsWith", value: "Lead" } }),
    ).toEqual({ AND: [{ nameJa: { startsWith: "Lead", mode: "insensitive" } }] });
  });

  it("空白・空白でない を null と空文字の両方で見る", () => {
    expect(buildWhere(COLUMNS, { nameJa: { kind: "text", op: "empty", value: "" } })).toEqual({
      AND: [{ OR: [{ nameJa: null }, { nameJa: "" }] }],
    });
  });

  it("選択肢は in で絞る", () => {
    expect(buildWhere(COLUMNS, { status: { kind: "enum", values: ["ACTIVE"] } })).toEqual({
      AND: [{ status: { in: ["ACTIVE"] } }],
    });
  });

  /**
   * Prisma の Boolean 型には in が無く、渡すと実行時エラーになる。
   * 「はい」だけ選んだときに一覧が 500 で落ちていたので、値そのものを渡す形に固定する。
   */
  describe("はい/いいえ の列", () => {
    it("片方だけ選んだら真偽値そのもので絞る", () => {
      expect(buildWhere(COLUMNS, { activeFlag: { kind: "enum", values: ["true"] } })).toEqual({
        AND: [{ activeFlag: true }],
      });
      expect(buildWhere(COLUMNS, { activeFlag: { kind: "enum", values: ["false"] } })).toEqual({
        AND: [{ activeFlag: false }],
      });
    });

    it("両方選んだらフィルターしない（列は null を取らないため）", () => {
      expect(
        buildWhere(COLUMNS, { activeFlag: { kind: "enum", values: ["true", "false"] } }),
      ).toEqual({});
    });
  });

  it("日付の範囲は終わりの日いっぱいを含む", () => {
    const where = buildWhere(COLUMNS, {
      updatedAt: { kind: "date", op: "between", value: "2026-01-01", value2: "2026-01-31" },
    }) as { AND: { updatedAt: { gte: Date; lte: Date } }[] };
    expect(where.AND[0]?.updatedAt.gte.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(where.AND[0]?.updatedAt.lte.toISOString()).toBe("2026-01-31T23:59:59.999Z");
  });

  it("数値の範囲は上下が逆でも直して扱う", () => {
    expect(
      buildWhere(COLUMNS, { count: { kind: "number", op: "between", value: "10", value2: "5" } }),
    ).toEqual({ AND: [{ count: { gte: 5, lte: 10 } }] });
  });

  it("数値でない値は無視する（一覧が空になるのを防ぐ）", () => {
    expect(buildWhere(COLUMNS, { count: { kind: "number", op: "eq", value: "abc" } })).toEqual({});
  });

  it("列の種類と食い違う条件は無視する", () => {
    expect(buildWhere(COLUMNS, { status: { kind: "text", op: "contains", value: "x" } })).toEqual(
      {},
    );
  });

  it("子テーブルの列は「1件でも合えば該当」に包む", () => {
    expect(buildWhere(COLUMNS, { tags: { kind: "text", op: "contains", value: "1-234" } })).toEqual(
      {
        AND: [{ tags: { some: { label: { contains: "1-234" } } } }],
      },
    );
  });

  it("子テーブルの「空白」は行が1件も無いこと（列がNULLかどうかではない）", () => {
    expect(buildWhere(COLUMNS, { tags: { kind: "text", op: "empty", value: "" } })).toEqual({
      AND: [{ tags: { none: {} } }],
    });
    expect(buildWhere(COLUMNS, { tags: { kind: "text", op: "notEmpty", value: "" } })).toEqual({
      AND: [{ tags: { some: {} } }],
    });
  });

  it("複数の条件は AND で重ねる", () => {
    const where = buildWhere(COLUMNS, {
      status: { kind: "enum", values: ["ACTIVE"] },
      nameJa: { kind: "text", op: "contains", value: "鉛" },
    }) as { AND: unknown[] };
    expect(where.AND).toHaveLength(2);
  });
});

describe("buildOrderBy", () => {
  it("指定が無ければ既定の並びだけ", () => {
    expect(buildOrderBy(COLUMNS, [], { codeNormalized: "asc" })).toEqual([
      { codeNormalized: "asc" },
    ]);
  });

  it("複数列を指定順に並べ、最後に一意な列を足す", () => {
    expect(
      buildOrderBy(
        COLUMNS,
        [
          { column: "status", direction: "desc" },
          { column: "nameJa", direction: "asc" },
        ],
        { codeNormalized: "asc" },
      ),
    ).toEqual([{ status: "desc" }, { nameJa: "asc" }, { codeNormalized: "asc" }]);
  });

  it("並べ替えできない列と知らない列は無視する", () => {
    expect(
      buildOrderBy(
        COLUMNS,
        [
          { column: "id", direction: "asc" },
          { column: "unknown", direction: "asc" },
        ],
        { codeNormalized: "asc" },
      ),
    ).toEqual([{ codeNormalized: "asc" }]);
  });

  it("既定の列が指定済みなら重ねない", () => {
    expect(
      buildOrderBy(COLUMNS, [{ column: "casNumber", direction: "asc" }], { casNormalized: "asc" }),
    ).toEqual([{ casNormalized: "asc" }]);
  });
});
