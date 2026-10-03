/**
 * CASリンクの受け皿を用意する。データソース種別・バージョン・データソースの3つ。
 *
 * `seed-cas-links.ts` はこれらが既にあることを前提にしているので、
 * まっさらな環境（本番など）ではこちらを先に流す。
 * 既にあるものは触らない。何度流しても結果は同じ。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-link-setup.ts [バージョンコード] [基準日 YYYY-MM-DD]
 *
 * バージョンコードを省くと 2026Q3。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_CODE = "LOLI";
const SOURCE_NOTE = "UL Illumimator のデータベース";

/**
 * 基準日（そのデータが何時点のものか）。必須の欄なので、作るときに決める（2026-10-03 に足した）。
 * `2026Q4` のような名前なら、その四半期の初日（Q1=1/1・Q2=4/1・Q3=7/1・Q4=10/1。既にある版と同じ決めかた）。
 * それ以外の名前は第2引数に YYYY-MM-DD で渡す
 */
function asOfOf(code: string): Date {
  const given = process.argv[3];
  if (given) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(given)) throw new Error(`基準日は YYYY-MM-DD で: ${given}`);
    return new Date(`${given}T00:00:00Z`);
  }
  const m = code.match(/^(\d{4})Q([1-4])$/i);
  if (!m)
    throw new Error(`基準日を決められません。第2引数に YYYY-MM-DD で渡してください（${code}）`);
  const month = (Number(m[2]) - 1) * 3 + 1;
  return new Date(`${m[1]}-${String(month).padStart(2, "0")}-01T00:00:00Z`);
}

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
      data: { code: versionCode, codeNormalized: normalized, asOf: asOfOf(versionCode) },
    });
    console.log(`バージョン ${version.code} を作りました`);
  }

  // 現在のバージョンはシステム全体で1件だけ。まだ誰も立っていなければ、これを立てる
  const current = await prisma.linkSetVersion.findFirst({ where: { isCurrent: true } });
  if (!current) {
    await prisma.linkSetVersion.update({
      where: { id: version.id },
      data: { isCurrent: true },
    });
    console.log(`バージョン ${version.code} を現在のバージョンにしました`);
  } else {
    console.log(`現在のバージョンは ${current.code} です（変えません）`);
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
