import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 一覧の「選択した行を削除」で、確かめのウィンドウを 2 回出している所の検出。
 * 確かめは表の部品（`components/data-table`）が 1 回出す。呼び出し側の消す処理でも `ask(` を呼ぶと、
 * 同じことを 2 回尋ねる（2026-11-17、アクセス記録の画面で起きていた。「選択した 2 件を削除しますか？」のあとに
 * 「選んだ 2 件の記録を消します。…」がもう 1 回出た）。文を変えたいときは `deleteConfirmMessage` を渡す。
 */

const WEB_DIR = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "public"]);

function findSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...findSources(full));
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

/** `open` の位置にある開きかっこに対応する閉じかっこの位置 */
function closing(text: string, open: number): number {
  const o = text.charAt(open);
  const c = o === "(" ? ")" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === o) depth += 1;
    else if (text[i] === c) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `function 名前(…) {…}` の中身。見つからなければ null */
function bodyOf(text: string, name: string): string | null {
  const hit = new RegExp(`function ${name}\\s*\\(`).exec(text);
  if (!hit) return null;
  const paramsEnd = closing(text, hit.index + hit[0].length - 1);
  if (paramsEnd < 0) return null;
  const open = text.indexOf("{", paramsEnd);
  const end = open < 0 ? -1 : closing(text, open);
  return end < 0 ? null : text.slice(open, end + 1);
}

describe("一覧の「選択した行を削除」の確かめ", () => {
  it("消す処理の中で、もう 1 回確かめを出さない", () => {
    const twice: string[] = [];
    let checked = 0;
    for (const file of findSources(WEB_DIR)) {
      const text = readFileSync(file, "utf8");
      const rel = relative(WEB_DIR, file).split(sep).join("/");
      if (rel.startsWith("components/data-table/")) continue;
      for (const hit of text.matchAll(/onDeleteSelected=\{/g)) {
        const open = hit.index + hit[0].length - 1;
        const expr = text.slice(open, closing(text, open) + 1);
        // 渡している式そのもの（その場に書いた処理）
        if (/\bask\(/.test(expr)) twice.push(`${rel}: onDeleteSelected の中`);
        // 式が呼んでいる、同じファイルの処理
        for (const name of new Set(expr.match(/[A-Za-z_]\w*/g) ?? [])) {
          const body = bodyOf(text, name);
          if (body === null) continue;
          checked += 1;
          if (/\bask\(|\bconfirm\(/.test(body)) twice.push(`${rel}: ${name}()`);
        }
      }
    }
    expect(twice).toEqual([]);
    // 見るべき処理を見つけられなくなっていないこと（書き方が変わって素通りするのを防ぐ）
    expect(checked).toBeGreaterThanOrEqual(20);
  });
});
