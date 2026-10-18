// SDS モジュールの生成（scripts/gen-modules.mjs がモジュールごとに呼ぶ。dev・build・typecheck・test の前）。
//
// ルールセット（rules/samples/*.ghsrule）の本文を TypeScript に写す。
// 実行時にファイルを読まないのは、導入セット・Docker の写しに .ghsrule が無くても動くようにするため
// （CLAUDE.md「導入先で動く作りは 3 つの入れ方で確かめる」）。手で直さない
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const samples = join(here, "rules", "samples");
const outDir = join(here, "rules", "generated");
const files = readdirSync(samples)
  .filter((f) => f.endsWith(".ghsrule"))
  .sort();
const entries = files.map((f) => {
  const text = readFileSync(join(samples, f), "utf8");
  return `  ${JSON.stringify(f)}: ${JSON.stringify(text)},`;
});
const out =
  `// apps/web/modules/sds/generate.mjs が作るファイル（dev・build・typecheck・test の前）。手で直さない。\n` +
  `// rules/samples/*.ghsrule の本文。実行時にファイルを読まずに済むように写してある\n` +
  `export const BUILTIN_RULESET_TEXTS: Record<string, string> = {\n${entries.join("\n")}\n};\n`;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "rulesets.ts"), out);

// Langium が作るファイルは相対 import に `.js` を付ける（`./ast.js`）。Next.js はこれを解決できない
// （CLAUDE.md §5 の 1）ので、拡張子を落とす。何度流しても同じ結果になる
let stripped = 0;
for (const f of readdirSync(outDir).filter((x) => x.endsWith(".ts"))) {
  const path = join(outDir, f);
  const before = readFileSync(path, "utf8");
  const after = before.replace(/(from\s+['"]\.\.?\/[^'"]+)\.js(['"])/g, "$1$2");
  if (after !== before) {
    writeFileSync(path, after);
    stripped++;
  }
}
console.warn(`gen-modules(sds): rulesets ${files.length}, .js import stripped ${stripped}`);
