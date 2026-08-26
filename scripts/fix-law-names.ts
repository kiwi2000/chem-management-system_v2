/**
 * 化管法・毒劇法の法文物質名を、原文から作り直したデータに合わせる。
 *
 *   npx tsx scripts/fix-law-names.ts          下見
 *   npx tsx scripts/fix-law-names.ts --write  書き込む
 *
 * **入れ直しではなく、名前だけを差し替える。**
 * これらの法文物質名には CAS リンクが付いており、
 * `seed-*.ts` は消してから入れ直すので、流すとリンクまで消える。
 *
 * 元になるのは `scripts/data/*.json`。
 * 先に `npx tsx scripts/build-law-data.ts --write` で作り直しておくこと。
 *
 * `note` は触らない。`seed-dokugeki-thresholds.ts` が
 * 閾値の読み取り結果を書き足しているため（上書きするとそれが消える）。
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface Target {
  /** `statutory_substances.code` */
  code: string;
  name: string;
}

function fromKakanho(): Target[] {
  const rows = JSON.parse(readFileSync("scripts/data/kakanho.json", "utf8")) as {
    section: string;
    number: string;
    name: string;
  }[];
  return rows.map((r) => ({ code: `JP-PRTR-${r.section}-${r.number}`, name: r.name }));
}

function fromDokugeki(): Target[] {
  const rows = JSON.parse(readFileSync("scripts/data/dokugeki.json", "utf8")) as {
    section: string;
    src: string;
    number: string;
    name: string;
  }[];
  return rows.map((r) => ({
    code: `JP-PDSCA-${r.section}-${r.src}-${r.number}`,
    name: r.name,
  }));
}

async function main() {
  const write = process.argv.includes("--write");
  const targets = [...fromKakanho(), ...fromDokugeki()];

  const rows = await prisma.statutorySubstance.findMany({
    where: { deletedAt: null, code: { in: targets.map((t) => t.code) } },
    select: { id: true, code: true, nameOriginal: true, nameJa: true },
  });
  const byCode = new Map(rows.map((r) => [r.code, r]));

  let changed = 0;
  let missing = 0;
  for (const t of targets) {
    const row = byCode.get(t.code);
    if (!row) {
      console.log(`  ✗ ${t.code} が DB にありません`);
      missing += 1;
      continue;
    }
    const current = row.nameJa ?? row.nameOriginal;
    if (current === t.name) continue;
    console.log(`  ${t.code}`);
    console.log(`    前: ${current}`);
    console.log(`    後: ${t.name}`);
    changed += 1;
    if (write) {
      await prisma.statutorySubstance.update({
        where: { id: row.id },
        // 名前は name_original に入っている。name_ja は空のことが多い
        data: { nameOriginal: t.name, ...(row.nameJa ? { nameJa: t.name } : {}) },
      });
    }
  }

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log(`  照らし合わせた: ${targets.length}件`);
  console.log(`  直す          : ${changed}件`);
  console.log(`  DBに無い      : ${missing}件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
