/**
 * 厚生労働省・労働安全衛生総合研究所（JNIOSH）の対象物質一覧から、CASリンクを作る。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json  *     scripts/seed-mhlw-self-links.ts [--write]
 *
 * 対象は安衛法の2区分（皮膚等障害化学物質等・がん原性物質）。どちらも告示で名称だけを
 * 指定していて、告示の本文に CAS は無い。告示を出した側が「法令上の名称」と「CAS RN」の
 * 対応表（Excel）を公表しているので、**法文物質名の番号にその CAS を入れてある**
 * （`scripts/build-mhlw-data.ts`、`docs/法規制データの作り方.md` 第3章）。
 *
 * **この対応表を、出どころ `MHLW` として全件結ぶ。**
 * LOLI・CHRIP が持っているかどうかは見ない。データソースはそれぞれ単独で成り立たせ、
 * 重なりは優先順位で決める（第0章 0-2、2026-09-03 の判断）。
 * はじめは「LOLI・CHRIP に無い78件だけ」を埋める作りにしていたが、それでは MHLW の中身が
 * 他のソースの状態で変わってしまい、単独では成り立たない。誤りだったので全件にした。
 *
 * 出どころ `MHLW` が無ければ作り、いまのバージョンに紐づける（優先順位は末尾）。
 * 何度流しても増えない。
 */
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_CODE = "MHLW";
const SOURCE_NOTE =
  "厚生労働省・JNIOSH の対象物質一覧（法令上の名称と CAS RN の対応表）。" +
  "皮膚等障害化学物質等: https://www.mhlw.go.jp/content/11300000/001708898.xlsx ／ " +
  "がん原性物質: https://www.jniosh.johas.go.jp/groups/ghs/Rec_save_30yr_List_R09_20250410.xlsx";
const VERSION_NOTE = "厚生労働省・JNIOSH の対象物質一覧（皮膚等障害・がん原性物質）";
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** 番号が CAS になっている区分。鉛等は条文の定義を1件ずつ持つだけで CAS では無いので対象外 */
const TARGETS: { law: string; category: string }[] = [
  { law: "JP-ISHA", category: "SKIN" },
  { law: "JP-ISHA", category: "CARC30" },
];

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) throw new Error("現在のバージョンが決まっていません");

  let source = await prisma.source.findFirst({
    where: { codeNormalized: normalizeCode(SOURCE_CODE), deletedAt: null },
    select: { id: true },
  });
  if (source && write) {
    // 説明文（出どころの URL）は毎回そろえる。バージョンへの紐づけの説明も同じく
    await prisma.source.update({ where: { id: source.id }, data: { note: SOURCE_NOTE } });
    await prisma.linkVersionSource.updateMany({
      where: { versionId: version.id, sourceId: source.id },
      data: { note: VERSION_NOTE },
    });
  }
  if (!source) {
    if (!write) {
      console.log(`  出どころ ${SOURCE_CODE} を作ります（--write のとき）`);
    } else {
      source = await prisma.source.create({
        data: {
          code: SOURCE_CODE,
          codeNormalized: normalizeCode(SOURCE_CODE),
          note: SOURCE_NOTE,
        },
        select: { id: true },
      });
      const last = await prisma.linkVersionSource.findFirst({
        where: { versionId: version.id },
        orderBy: { priority: "desc" },
        select: { priority: true },
      });
      await prisma.linkVersionSource.create({
        data: {
          versionId: version.id,
          sourceId: source.id,
          priority: (last?.priority ?? 0) + 1,
          note: VERSION_NOTE,
        },
      });
      console.log(`  出どころ ${SOURCE_CODE} を作りました`);
    }
  }

  // CASリンクは物質マスタにある番号にだけ張れる
  const known = new Set(
    (await prisma.substance.findMany({ select: { casNumber: true } }))
      .map((s) => s.casNumber)
      .filter((c): c is string => !!c),
  );

  let added = 0;
  for (const t of TARGETS) {
    const rows = await prisma.statutorySubstance.findMany({
      where: {
        deletedAt: null,
        regulationClass: {
          deletedAt: null,
          category: {
            deletedAt: null,
            codeNormalized: normalizeCode(t.category),
            law: { deletedAt: null, codeNormalized: normalizeCode(t.law) },
          },
        },
      },
      select: { id: true, officialNumber: true, nameOriginal: true },
    });

    const usable = rows.filter(
      (r) => r.officialNumber && CAS_SHAPE.test(r.officialNumber) && known.has(r.officialNumber),
    );
    const outside = rows.length - usable.length;

    if (write && source) {
      for (let i = 0; i < usable.length; i += 500) {
        await prisma.statutoryCasLink.createMany({
          data: usable.slice(i, i + 500).map((r) => ({
            statutorySubstanceId: r.id,
            casNumber: r.officialNumber!,
            casNormalized: normalizeCas(r.officialNumber!),
            versionId: version.id,
            sourceId: source!.id,
          })),
          skipDuplicates: true,
        });
      }
    }
    added += usable.length;
    console.log(
      `  ${t.law}/${t.category}`.padEnd(22) +
        `結べる ${String(usable.length).padStart(3)} 件` +
        (outside ? ` / 番号がCASでない・物質マスタに無い ${outside} 件` : ""),
    );
  }

  console.log(
    write ? `\n張りました: ${added} 件` : `\n下見だけ。張るなら --write（対象 ${added} 件）`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
