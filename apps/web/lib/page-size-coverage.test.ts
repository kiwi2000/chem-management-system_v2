import { PAGE_SIZE_MAX } from "@chem/shared";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「全部ください」のつもりで、受け付ける上限を超える件数を頼んでいる所の検出。
 * 上限（PAGE_SIZE_MAX）を超える `size=` は無効として既定の 15 件に落ちる。誤りにならず黙って減るので、
 * データが少ない開発の環境では気づけない（2026-11-12、権限グループの画面が `size=1000` で先頭の 15 件しか読めていなかった）。
 */

const WEB_DIR = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "public"]);

function findSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...findSources(full));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("一覧の API に頼む件数", () => {
  it(`size= は上限（${PAGE_SIZE_MAX}）まで`, () => {
    const over: string[] = [];
    for (const file of findSources(WEB_DIR)) {
      const text = readFileSync(file, "utf8");
      for (const hit of text.matchAll(/[?&]size=(\d+)/g)) {
        if (Number(hit[1]) > PAGE_SIZE_MAX) {
          over.push(`${relative(WEB_DIR, file).split(sep).join("/")}: size=${hit[1]}`);
        }
      }
    }
    expect(over).toEqual([]);
  });
});
