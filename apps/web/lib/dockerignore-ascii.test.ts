import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Railway へ送るものに、日本語入りの .dockerignore が混ざらないことの点検。
 * 混ざると、Railway の組み立てが「exclude-patterns contains value with non-printable ASCII characters」で
 * 止まる（2026-11-24。10 月から通っていたのが、この日から止まった）。送られていたのは、git の管理外にある
 * 作業用の写し .claude/worktrees/ の中の .dockerignore だった。説明は Dockerfile の先頭に書く。
 */
const root = join(__dirname, "..", "..", "..");

describe(".dockerignore", () => {
  it("半角の英数字・記号と改行だけでできている", () => {
    const text = readFileSync(join(root, ".dockerignore"), "utf8");
    const bad = text
      .split("\n")
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter((l) => /[^\x20-\x7E\r]/.test(l.text));
    expect(bad).toEqual([]);
  });

  it("作業用の写し（.claude）を Railway へ送らない", () => {
    const lines = readFileSync(join(root, ".railwayignore"), "utf8")
      .split("\n")
      .map((l) => l.trim());
    expect(lines).toContain(".claude");
  });
});
