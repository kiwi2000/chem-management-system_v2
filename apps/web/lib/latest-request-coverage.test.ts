import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 一覧の画面が、遅れて届いた古い結果で表を上書きしないことの点検（2026-11-27）。
 * 条件が変わるたびにデータを取りに行くので、前の問い合わせがあとから届くと、
 * 「欄には条件が出ているのに、表は前の条件」になる（物質の一覧で、開き直して前回の条件を戻したとき）。
 *
 * `useTableState` を使う画面は、読み込みに `useLatestRequest`（lib/use-latest-request.ts）を通す。
 * 別の書き方で古い結果を捨てている画面は、理由と一緒に下に載せる。
 */

const WEB_DIR = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "public"]);

/** 別の書き方で、後から頼んだものを勝たせている画面 */
const OTHER_GUARD: Record<string, RegExp> = {
  // 問い合わせのアドレス（キー）を覚え、届いたものと突き合わせる
  "components/cas-link-section.tsx": /wantKey\.current !== key/,
  "components/cas-link-table.tsx": /wantKey\.current !== url/,
};

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

describe("一覧の読み込み", () => {
  it("useTableState を使う画面は、最後に頼んだ結果だけを表に出す", () => {
    const missing: string[] = [];
    for (const file of findSources(WEB_DIR)) {
      const rel = relative(WEB_DIR, file).split(sep).join("/");
      if (rel === "lib/use-table-state.ts") continue;
      const text = readFileSync(file, "utf8");
      if (!/useTableState\(/.test(text)) continue;
      const guard = OTHER_GUARD[rel];
      const ok = guard ? guard.test(text) : /useLatestRequest\(\)/.test(text);
      if (!ok) missing.push(rel);
    }
    expect(missing).toEqual([]);
  });

  it("useLatestRequest を作った読み込みは、結果を置く前に isLatest() を見る", () => {
    const bad: string[] = [];
    for (const file of findSources(WEB_DIR)) {
      const rel = relative(WEB_DIR, file).split(sep).join("/");
      const text = readFileSync(file, "utf8");
      const made = (text.match(/= useLatestRequest\(\)/g) ?? []).length;
      if (made === 0) continue;
      const begun = (text.match(/const isLatest = beginRequest\(\)/g) ?? []).length;
      const checked = (text.match(/if \(!isLatest\(\)\) return/g) ?? []).length;
      // 作った数だけ始めていて、始めた数以上見ていること（結果を置く直前、最後の await のあとに要る）
      if (begun < made || checked < begun)
        bad.push(`${rel}: 作成 ${made} / 開始 ${begun} / 確認 ${checked}`);
    }
    expect(bad).toEqual([]);
  });
});
