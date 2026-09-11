/**
 * 法規制データの写しをファイルに書き出す（事前チェックの入力）。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     tools/precheck/export.ts --out .cache/precheck/base.json --label "当方 正規 2026-09-11"
 *
 * 読み先は DATABASE_URL。顧客環境はトンネル越しの一時ファイル（.cache/prod.env のような）を
 * --env-file に渡す。**読むだけで、書き込まない。**
 *
 * 画面からの「書き出し」ができたら、その出力を同じ形（lib/snapshot.ts の Snapshot）にそろえる
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PrismaClient } from "@prisma/client";
import { takeSnapshot } from "./lib/snapshot";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v === undefined) {
    if (fallback !== undefined) return fallback;
    console.error(`--${name} が要ります`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const out = arg("out");
  const label = arg("label", `写し ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  const prisma = new PrismaClient();
  try {
    const snap = await takeSnapshot(prisma, label);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(snap), "utf-8");
    const cats = snap.laws.reduce((n, l) => n + l.categories.length, 0);
    const subs = snap.laws.reduce(
      (n, l) =>
        n +
        l.categories.reduce(
          (m, c) => m + c.classes.reduce((k, x) => k + x.substances.length, 0),
          0,
        ),
      0,
    );
    const links = snap.laws.reduce(
      (n, l) =>
        n +
        l.categories.reduce(
          (m, c) =>
            m +
            c.classes.reduce((k, x) => k + x.substances.reduce((j, s) => j + s.links.length, 0), 0),
          0,
        ),
      0,
    );
    console.log(`書き出しました: ${out}`);
    console.log(
      `  法律 ${snap.laws.length} / 区分 ${cats} / 法文物質名 ${subs} / 結び付き ${links}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
