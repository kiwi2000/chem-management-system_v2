/**
 * CASリンクの受け皿を用意する。データソース種別・バージョン・データソースの3つ。
 *
 * `seed-cas-links.ts` はこれらが既にあることを前提にしているので、
 * まっさらな環境（本番など）ではこちらを先に流す。
 * 既にあるものは触らない。何度流しても結果は同じ。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-link-setup.ts [版コード]
 *
 * 版コードを省くと 2026Q3。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_CODE = "LOLI";
const SOURCE_NOTE = "UL Illumimator のデータベース";

async function main() {
  const versionCode = process.argv[2] ?? "2026Q3";

  let source = await prisma.source.findFirst({ where: { codeNormalized: SOURCE_CODE } });
  if (source) {
    console.log(`データソース種別 ${source.code} は既にあります`);
  } else {
    source = await prisma.source.create({
      data: { code: SOURCE_CODE, codeNormalized: SOURCE_CODE, note: SOURCE_NOTE },
    });
    console.log(`データソース種別 ${source.code} を作りました`);
  }

  const normalized = versionCode.toUpperCase();
  let version = await prisma.linkSetVersion.findFirst({ where: { codeNormalized: normalized } });
  if (version) {
    console.log(`バージョン ${version.code} は既にあります`);
  } else {
    version = await prisma.linkSetVersion.create({
      data: { code: versionCode, codeNormalized: normalized },
    });
    console.log(`バージョン ${version.code} を作りました`);
  }

  // 現在版はシステム全体で1件だけ。まだ誰も立っていなければ、これを立てる
  const current = await prisma.linkSetVersion.findFirst({ where: { isCurrent: true } });
  if (!current) {
    await prisma.linkSetVersion.update({
      where: { id: version.id },
      data: { isCurrent: true },
    });
    console.log(`バージョン ${version.code} を現在版にしました`);
  } else {
    console.log(`現在版は ${current.code} です（変えません）`);
  }

  const link = await prisma.linkVersionSource.findFirst({
    where: { versionId: version.id, sourceId: source.id },
  });
  if (link) {
    console.log(`データソース ${version.code} × ${source.code} は既にあります`);
  } else {
    // 優先度は末尾に付ける。並べ替えは画面から行う
    const last = await prisma.linkVersionSource.findFirst({
      where: { versionId: version.id },
      orderBy: { priority: "desc" },
    });
    await prisma.linkVersionSource.create({
      data: {
        versionId: version.id,
        sourceId: source.id,
        priority: (last?.priority ?? 0) + 1,
      },
    });
    console.log(`データソース ${version.code} × ${source.code} を作りました`);
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
