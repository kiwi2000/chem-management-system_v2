// 差込口の一覧（apps/web/modules/registry*.generated.ts）を作る。
//
// 本体はモジュールのフォルダを直接 import せず、ここで作る一覧だけを読む。
// 一覧に載らないモジュールのコードは、Next.js のビルドに一切入らない。
//
//   node scripts/gen-modules.mjs all    見つかったモジュールを全部（dev・typecheck・test）
//   node scripts/gen-modules.mjs        環境変数 CHEM_MODULES（例: sds / sds,foo）か、
//                                       apps/web/modules/enabled.json（配布物に同梱）に挙がったものだけ（build）。
//                                       どちらも無ければ空
//
// フォルダが無いモジュールを指定したら止める（SDS なし版に SDS の指定が紛れ込んだとき、黙って組まないため）
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "apps", "web", "modules");

const found = existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "manifest.ts")))
      .map((d) => d.name)
      .sort()
  : [];

function wantedModules() {
  if (process.argv[2] === "all") return found;
  const env = (process.env.CHEM_MODULES ?? "").trim();
  if (env === "all") return found;
  if (env !== "")
    return env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const enabled = join(dir, "enabled.json");
  if (existsSync(enabled)) {
    const list = JSON.parse(readFileSync(enabled, "utf8"));
    if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) {
      throw new Error(`gen-modules: ${enabled} は文字列の配列でなければなりません`);
    }
    return list;
  }
  return [];
}

const wanted = [...new Set(wantedModules())];
const missing = wanted.filter((w) => !found.includes(w));
if (missing.length > 0) {
  console.error(
    `gen-modules: 見つからないモジュール: ${missing.join(", ")}（apps/web/modules/ に manifest.ts を持つフォルダが無い）`,
  );
  process.exit(1);
}

const ident = (id) => id.replace(/[^a-zA-Z0-9]/g, "_");
const header =
  `// scripts/gen-modules.mjs が作るファイル（dev・build・typecheck・test の前）。手で直さない。git にも入れない。\n` +
  `// 有効なモジュール: ${wanted.length > 0 ? wanted.join(", ") : "なし"}\n`;

const manifest =
  header +
  `import type { ModuleManifest } from "./types";\n` +
  wanted.map((id) => `import ${ident(id)} from "./${id}/manifest";\n`).join("") +
  `\nexport const MODULES: ModuleManifest[] = [${wanted.map(ident).join(", ")}];\n`;

const server =
  header +
  `import type { ModuleServer } from "./types";\n` +
  wanted.map((id) => `import ${ident(id)} from "./${id}/server";\n`).join("") +
  `\nexport const SERVER_MODULES: ModuleServer[] = [${wanted.map(ident).join(", ")}];\n`;

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "registry.generated.ts"), manifest);
writeFileSync(join(dir, "registry.server.generated.ts"), server);
console.log(`gen-modules: ${wanted.length > 0 ? wanted.join(", ") : "(なし)"}`);
