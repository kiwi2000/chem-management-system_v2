/**
 * 厚生労働省が公開している一覧から、**法令上の名称と裾切値**を取り出す。
 * 出来上がりは `scripts/data/jp-extra-mhlw.json`。取り込みは seed-jp-extra-laws.ts。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/build-mhlw-data.ts
 *   ... scripts/build-mhlw-data.ts --write
 *
 * **この2つは告示なので e-Gov の法令検索に載っていない。**
 * 代わりに厚生労働省が Excel の一覧を出しており、そこに「法令上の名称」の欄がある。
 * 外部データベース（CHRIP・LOLI）の物質名より、こちらが上。
 *
 * **元のファイルは差し替えられる。**URL が 404 になったら、
 * 厚生労働省の「化学物質による労働災害防止のための新たな規制」のページから探し直す。
 * 取ってきたものは `.cache/mhlw/` に残るので、次からは取りに行かない。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error 圧縮の解凍を素の Node だけで書いてあるため .mjs
import { readSheet } from "./lib/xlsx-read.mjs";
import { toDisplayName } from "./lib/law-name";

const CACHE = join(process.cwd(), ".cache", "mhlw");
const DATA = join(process.cwd(), "scripts", "data");
const OUT = "jp-extra-mhlw.json";

const FILES = {
  skin: {
    url: "https://www.mhlw.go.jp/content/11300000/001708898.xlsx",
    file: "skin.xlsx",
    label: "皮膚等障害化学物質等",
  },
  carcinogen: {
    url: "https://www.jniosh.johas.go.jp/groups/ghs/Rec_save_30yr_List_R09_20250410.xlsx",
    file: "carcinogen30.xlsx",
    label: "がん原性物質（作業記録30年保存）",
  },
} as const;

async function load(which: keyof typeof FILES): Promise<string[][]> {
  const def = FILES[which];
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, def.file);
  if (!existsSync(path)) {
    const res = await fetch(def.url);
    if (!res.ok) throw new Error(`${def.label} を取れません（${res.status}）: ${def.url}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return readSheet(readFileSync(path)) as string[][];
}

/** 見出しの行を探して、そこから下を返す */
function body(rows: string[][], label: string): string[][] {
  const at = rows.findIndex((r) => (r[0] ?? "").trim() === "CAS RN");
  if (at < 0) throw new Error(`${label}: 見出しの行（CAS RN）が見つかりません`);
  return rows.slice(at + 1).filter((r) => /^\d{2,7}-\d{2}-\d$/.test((r[0] ?? "").trim()));
}

/** `45383` のような Excel の日付の数を `2024-04-01` にする */
function excelDate(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 20000) return raw.replace(/\r?\n/g, " ").trim();
  // Excel は 1899-12-30 を 0 として数える
  const ms = Date.UTC(1899, 11, 30) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

interface SkinRow {
  cas: string;
  /** 労働安全衛生法令の名称。これを法文物質名にする */
  name: string;
  /** 皮膚刺激性有害物質 */
  irritation: boolean;
  /** 皮膚吸収性有害物質 */
  absorption: boolean;
  /** 特別規則（特化則など）に基づく使用義務物質 */
  special: boolean;
  /** 裾切値（重量パーセント）。**この値以上で対象** */
  cutoff: string;
  applied: string;
  note: string;
}

interface CarcinogenRow {
  cas: string;
  name: string;
  /** 発がん性区分（区分1A・区分1B） */
  category: string;
  /** 適用時期（令和5年度など） */
  applied: string;
  note: string;
}

const mark = (v: string | undefined) => (v ?? "").trim() !== "";
const cell = (r: string[], i: number) => (r[i] ?? "").replace(/\r?\n/g, " ").trim();

async function main() {
  const write = process.argv.includes("--write");

  const skinRows = body(await load("skin"), FILES.skin.label);
  const skin: SkinRow[] = skinRows.map((r) => ({
    cas: cell(r, 0),
    // 法令の書き方は縦書きの組バージョン。ダーシを長音符に寄せる（第3章）
    name: toDisplayName(cell(r, 2) || cell(r, 1)),
    irritation: mark(r[4]),
    absorption: mark(r[5]),
    special: mark(r[6]),
    cutoff: cell(r, 7),
    applied: excelDate(cell(r, 8)),
    note: cell(r, 3),
  }));

  const carcRows = body(await load("carcinogen"), FILES.carcinogen.label);
  const carcinogen: CarcinogenRow[] = carcRows.map((r) => ({
    cas: cell(r, 0),
    name: toDisplayName(cell(r, 2) || cell(r, 1)),
    category: cell(r, 3),
    applied: cell(r, 5),
    note: cell(r, 4),
  }));

  console.log(`${FILES.skin.label}  ${skin.length} 件`);
  console.log(
    `  皮膚刺激性 ${skin.filter((s) => s.irritation).length} / ` +
      `皮膚吸収性 ${skin.filter((s) => s.absorption).length} / ` +
      `特別規則 ${skin.filter((s) => s.special).length} / ` +
      `どれにも印が無い ${skin.filter((s) => !s.irritation && !s.absorption && !s.special).length}`,
  );
  const cutoffs = new Map<string, number>();
  for (const s of skin) cutoffs.set(s.cutoff, (cutoffs.get(s.cutoff) ?? 0) + 1);
  console.log(
    `  裾切値: ${[...cutoffs]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k || "(なし)"}×${n}`)
      .join(" / ")}`,
  );

  console.log(`\n${FILES.carcinogen.label}  ${carcinogen.length} 件`);
  const cats = new Map<string, number>();
  for (const c of carcinogen) cats.set(c.category, (cats.get(c.category) ?? 0) + 1);
  console.log(`  ${[...cats].map(([k, n]) => `${k || "(なし)"}×${n}`).join(" / ")}`);
  for (const s of skin.slice(0, 3)) console.log(`  例）${s.cas} ${s.name}（裾切値 ${s.cutoff}%）`);
  for (const c of carcinogen.slice(0, 2)) console.log(`  例）${c.cas} ${c.name}（${c.category}）`);

  if (write) {
    writeFileSync(join(DATA, OUT), `${JSON.stringify({ skin, carcinogen }, null, 1)}\n`, "utf8");
    console.log(`\n${OUT} に書きました。seed-jp-extra-laws.ts を流し直してください。`);
  } else {
    console.log("\n下見だけ。書き込むなら --write");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
