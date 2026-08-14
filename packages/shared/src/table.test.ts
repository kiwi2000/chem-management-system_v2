import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  emptyTableState,
  parseTableState,
  serializeTableState,
  type ColumnKind,
  type TableState,
} from "./table";

/**
 * 一覧の状態は URL に載せて共有・復元するので、往復して同じものに戻ることを固定しておく。
 * 壊れた URL を渡されても落ちずに無視することも確認する。
 */
const COLUMNS: { key: string; kind: ColumnKind }[] = [
  { key: "code", kind: "text" },
  { key: "status", kind: "enum" },
  { key: "updatedAt", kind: "date" },
  { key: "count", kind: "number" },
];

const FALLBACK: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

const roundTrip = (state: TableState) =>
  parseTableState(serializeTableState(state, FALLBACK), COLUMNS, FALLBACK);

describe("一覧の状態の URL 往復", () => {
  it("既定のままなら URL に何も付かない", () => {
    expect(serializeTableState(FALLBACK, FALLBACK).toString()).toBe("");
  });

  it("複数列の並べ替えを順序どおり保つ", () => {
    const state: TableState = {
      ...FALLBACK,
      sort: [
        { column: "status", direction: "desc" },
        { column: "code", direction: "asc" },
      ],
    };
    expect(serializeTableState(state, FALLBACK).get("sort")).toBe("status:desc,code:asc");
    expect(roundTrip(state).sort).toEqual(state.sort);
  });

  it("文字列・選択肢・日付・数値の絞り込みが往復する", () => {
    const state: TableState = {
      ...FALLBACK,
      filters: {
        code: { kind: "text", op: "contains", value: "pb" },
        status: { kind: "enum", values: ["ACTIVE", "DISCONTINUED"] },
        updatedAt: { kind: "date", op: "between", value: "2026-01-01", value2: "2026-12-31" },
        count: { kind: "number", op: "gte", value: "10" },
      },
    };
    expect(roundTrip(state).filters).toEqual(state.filters);
  });

  it("値の要らない演算子は値なしで往復する", () => {
    const state: TableState = {
      ...FALLBACK,
      filters: { code: { kind: "text", op: "empty", value: "" } },
    };
    expect(roundTrip(state).filters.code).toEqual({ kind: "text", op: "empty", value: "" });
  });

  it("ページと表示件数を保つ", () => {
    const state: TableState = { ...FALLBACK, page: 3, pageSize: 100 };
    const back = roundTrip(state);
    expect(back.page).toBe(3);
    expect(back.pageSize).toBe(100);
  });

  it("並べ替えを空にした状態も保てる（既定に戻らない）", () => {
    const state: TableState = { ...FALLBACK, sort: [] };
    expect(roundTrip(state).sort).toEqual([]);
  });
});

describe("壊れた URL の扱い", () => {
  const parse = (qs: string) => parseTableState(new URLSearchParams(qs), COLUMNS, FALLBACK);

  it("知らない列は無視する", () => {
    expect(parse("sort=unknown:asc").sort).toEqual([]);
    expect(parse("f.unknown=contains:x").filters).toEqual({});
  });

  it("列の種類に合わない演算子は無視する", () => {
    expect(parse("f.code=gte:5").filters).toEqual({});
    expect(parse("f.status=contains:x").filters).toEqual({});
  });

  it("値が要るのに空なら無視する", () => {
    expect(parse("f.code=contains:").filters).toEqual({});
  });

  it("同じ列を2回指定しても1回だけ採用する", () => {
    expect(parse("sort=code:asc,code:desc").sort).toEqual([{ column: "code", direction: "asc" }]);
  });

  it("ページや件数が不正なら既定に戻す", () => {
    expect(parse("page=0&size=7").page).toBe(1);
    expect(parse("page=abc&size=7").pageSize).toBe(FALLBACK.pageSize);
  });

  it("並べ替えの指定が無ければ既定の並びを使う", () => {
    expect(parse("").sort).toEqual(FALLBACK.sort);
  });
});

describe("activeFilterCount", () => {
  it("掛かっている絞り込みの数を返す", () => {
    expect(activeFilterCount(FALLBACK)).toBe(0);
    expect(
      activeFilterCount({
        ...FALLBACK,
        filters: {
          code: { kind: "text", op: "contains", value: "a" },
          status: { kind: "enum", values: ["ACTIVE"] },
        },
      }),
    ).toBe(2);
  });
});
