import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * .dockerignore に半角の英数字・記号以外が入っていないことの点検。
 * 日本語の注釈があると、Railway の組み立てが「exclude-patterns contains value with non-printable ASCII characters」で
 * 止まる（2026-11-24。10 月から同じ注釈で通っていたのが、この日から止まった）。説明は Dockerfile の先頭に書く。
 */
describe(".dockerignore", () => {
  it("半角の英数字・記号と改行だけでできている", () => {
    const text = readFileSync(join(__dirname, "..", "..", "..", ".dockerignore"), "utf8");
    const bad = text
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter((l) => /[^\x20-\x7E\r]/.test(l.text));
    expect(bad).toEqual([]);
  });
});
