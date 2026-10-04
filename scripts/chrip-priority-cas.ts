/**
 * 物質マスタにある CAS（と CHRIP の独自コード）を書き出す。CHRIP の詳細を取る順で**最優先**にするため
 * （2026-10-04 指示。システムの物質が先に CHRIP の最新になる）。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/chrip-priority-cas.ts
 *
 * 出すもの: .cache/chrip/priority-cas.json（正規化した CAS の配列）。`chrip-fetch-detail.mjs` が読む。無ければ使わない
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.substance.findMany({
    where: { deletedAt: null, casNormalized: { not: null } },
    select: { casNormalized: true },
  });
  const cas = [...new Set(rows.map((r) => r.casNormalized!))];
  writeFileSync(".cache/chrip/priority-cas.json", JSON.stringify(cas));
  console.log(`物質マスタの CAS: ${cas.length.toLocaleString()} 件`);
}

main().finally(() => prisma.$disconnect());
