import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRuleset } from "./services";

const sample = (name: string) => readFileSync(join(__dirname, "samples", name), "utf8");

describe("ルール言語の文法（S27 の見本が読めること）", () => {
  for (const file of ["un-rev9.ghsrule", "jp-jis2025.ghsrule", "acme-jp.ghsrule"]) {
    it(`${file} を誤りなく読める`, async () => {
      const r = await parseRuleset(sample(file), file);
      expect(r.errors.map((e) => `${e.line}:${e.column} ${e.message}`)).toEqual([]);
      expect(r.ruleset?.name).toBeTruthy();
    });
  }

  it("文法の誤りは行と列つきで返す（例外にしない）", async () => {
    const r = await parseRuleset(
      'ruleset "x" version 1 {\n  rules { rule a { classify } }\n}\n',
      "bad",
    );
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]?.line).toBe(2);
  });
});
