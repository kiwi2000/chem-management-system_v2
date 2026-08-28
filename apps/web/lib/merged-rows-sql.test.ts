import { emptyTableState, parseTableState } from "@chem/shared";
import { describe, expect, it } from "vitest";
import { mergedPageQuery } from "./merged-rows-sql";

const COLS = [
  { key: "casNumber", kind: "text" as const },
  { key: "value", kind: "text" as const },
  { key: "updatedAt", kind: "date" as const },
];
const DEFAULT_STATE = emptyTableState([{ column: "casNumber", direction: "asc" }]);

function build(query: string) {
  const state = parseTableState(new URLSearchParams(query), COLS, DEFAULT_STATE);
  return mergedPageQuery("v1", "inv1", state);
}

describe("合算の1ページを引くSQL", () => {
  it("バージョンとインベントリは値として渡す（SQLに埋め込まない）", () => {
    const { sql, values } = build("size=25");
    expect(values[0]).toBe("v1");
    expect(values[1]).toBe("inv1");
    expect(sql).not.toContain("inv1");
  });

  it("CASごとに優先度のいちばん高い行だけ残す", () => {
    const { sql } = build("size=25");
    expect(sql).toContain("DISTINCT ON");
    expect(sql).toContain("lvs.priority NULLS LAST");
  });

  it("既定はCAS番号の昇順。数字は数として読む", () => {
    const { sql } = build("size=25");
    expect(sql).toMatch(/ORDER BY cas_normalized COLLATE "chem_natural"\s*$/m);
  });

  it("降順を指定すると DESC が付く", () => {
    const { sql } = build("size=25&sort=casNumber:desc");
    expect(sql).toContain('ORDER BY cas_normalized COLLATE "chem_natural" DESC');
  });

  it("同じ値が並ぶ列では、最後にCAS番号で順番を決め切る", () => {
    const { sql } = build("size=25&sort=value:asc");
    expect(sql).toContain(
      'ORDER BY value COLLATE "chem_natural", cas_normalized COLLATE "chem_natural"',
    );
  });

  it("更新日は文字ではなく日時として並べる", () => {
    const { sql } = build("size=25&sort=updatedAt:desc");
    expect(sql).toContain("ORDER BY updated_at DESC");
  });

  it("値の絞り込みは大文字小文字を区別しない", () => {
    const { sql, values } = build("size=25&f.value=contains:abc");
    expect(sql).toContain("value ILIKE");
    expect(values).toContain("%abc%");
  });

  it("CAS番号は揃えた形（全角や空白を直した形）にしてから当てる", () => {
    // 全角の数字・全角のハイフン・全角の空白を打っても当たる
    const { sql, values } = build(
      "size=25&f.casNumber=equals:%EF%BC%95%EF%BC%90%EF%BC%8D00%EF%BC%8D0",
    );
    expect(sql).toContain("cas_normalized =");
    expect(values).toContain("50-00-0");
  });

  it("前方一致・後方一致で当てる位置が変わる", () => {
    expect(build("size=25&f.value=startsWith:20").values).toContain("20%");
    expect(build("size=25&f.value=endsWith:20").values).toContain("%20");
  });

  it("LIKE の特別な文字は、ただの文字として扱う", () => {
    const { values } = build("size=25&f.value=contains:50%25");
    expect(values).toContain("%50\\%%");
  });

  it("空白・空白でないは値を渡さずに書く", () => {
    expect(build("size=25&f.value=empty:").sql).toContain("value IS NULL OR value = ''");
    expect(build("size=25&f.value=notEmpty:").sql).toContain("value IS NOT NULL AND value <> ''");
  });

  it("日付はその日いっぱいを含める", () => {
    const { values } = build("size=25&f.updatedAt=on:2026-08-27");
    expect(values).toContainEqual(new Date("2026-08-27T00:00:00.000Z"));
    expect(values).toContainEqual(new Date("2026-08-27T23:59:59.999Z"));
  });

  it("ページ送りは件数と位置を値として渡す", () => {
    const { values } = build("size=25&page=3");
    expect(values).toContain(25);
    expect(values).toContain(50);
  });

  it("件数は1ページぶんと一緒に取る（数え直さない）", () => {
    expect(build("size=25").sql).toContain("count(*) OVER () AS total");
  });
});
