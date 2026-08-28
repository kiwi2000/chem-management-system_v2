import { describe, expect, it } from "vitest";
import { applyFilters, matchesFilter } from "./table-match";

describe("手元の行を絞る", () => {
  describe("文字", () => {
    const f = (op: "contains" | "startsWith" | "endsWith" | "equals", value: string) =>
      ({ kind: "text", op, value }) as const;

    it("大文字小文字を区別しない", () => {
      expect(matchesFilter("Toluene", f("contains", "tolu"))).toBe(true);
      expect(matchesFilter("toluene", f("equals", "TOLUENE"))).toBe(true);
    });

    it("前・後ろでも当てられる", () => {
      expect(matchesFilter("7439-92-1", f("startsWith", "7439"))).toBe(true);
      expect(matchesFilter("7439-92-1", f("endsWith", "92-1"))).toBe(true);
      expect(matchesFilter("7439-92-1", f("startsWith", "92"))).toBe(false);
    });

    it("空欄では絞らない。1文字打つ前に全部消えると直しようがない", () => {
      expect(matchesFilter("なんでも", f("contains", ""))).toBe(true);
      expect(matchesFilter("", f("equals", ""))).toBe(true);
    });

    it("空・空でない", () => {
      expect(matchesFilter("", { kind: "text", op: "empty", value: "" })).toBe(true);
      expect(matchesFilter("あり", { kind: "text", op: "empty", value: "" })).toBe(false);
      expect(matchesFilter("あり", { kind: "text", op: "notEmpty", value: "" })).toBe(true);
    });

    it("null は空として扱う", () => {
      expect(matchesFilter(null, { kind: "text", op: "empty", value: "" })).toBe(true);
    });
  });

  describe("選択肢", () => {
    it("選んだものだけ残す", () => {
      expect(matchesFilter("該当", { kind: "enum", values: ["該当"] })).toBe(true);
      expect(matchesFilter("非該当", { kind: "enum", values: ["該当"] })).toBe(false);
    });

    it("何も選んでいなければ絞らない", () => {
      expect(matchesFilter("なんでも", { kind: "enum", values: [] })).toBe(true);
    });
  });

  describe("数", () => {
    it("以上・以下・範囲", () => {
      expect(matchesFilter("5", { kind: "number", op: "gte", value: "3" })).toBe(true);
      expect(matchesFilter("5", { kind: "number", op: "lte", value: "3" })).toBe(false);
      expect(matchesFilter("5", { kind: "number", op: "between", value: "3", value2: "8" })).toBe(
        true,
      );
    });

    it("数でないものは当たらない", () => {
      expect(matchesFilter("", { kind: "number", op: "eq", value: "1" })).toBe(false);
      expect(matchesFilter("あ", { kind: "number", op: "eq", value: "1" })).toBe(false);
    });
  });

  describe("日付", () => {
    it("以降・以前", () => {
      expect(matchesFilter("2026-08-28", { kind: "date", op: "from", value: "2026-08-01" })).toBe(
        true,
      );
      expect(matchesFilter("2026-08-28", { kind: "date", op: "to", value: "2026-08-01" })).toBe(
        false,
      );
    });

    it("時刻が付いていても、日付のところで比べる", () => {
      expect(
        matchesFilter("2026-08-28T09:00:00.000Z", { kind: "date", op: "on", value: "2026-08-28" }),
      ).toBe(true);
    });
  });

  describe("いくつも重ねる", () => {
    const rows = [
      { cas: "7439-92-1", name: "鉛", verdict: "該当" },
      { cas: "7440-50-8", name: "銅", verdict: "非該当" },
      { cas: "108-88-3", name: "トルエン", verdict: "該当" },
    ];
    const valueOf = (r: (typeof rows)[number], c: string) => (r as Record<string, string>)[c] ?? "";

    it("すべてを満たす行だけ残す", () => {
      const out = applyFilters(
        rows,
        {
          cas: { kind: "text", op: "startsWith", value: "74" },
          verdict: { kind: "enum", values: ["該当"] },
        },
        valueOf,
      );
      expect(out.map((r) => r.name)).toEqual(["鉛"]);
    });

    it("条件が無ければ、そのまま返す", () => {
      expect(applyFilters(rows, {}, valueOf)).toHaveLength(3);
    });
  });
});
