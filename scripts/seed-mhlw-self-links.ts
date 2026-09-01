/**
 * 厚生労働省の一覧から作った区分で、**法文物質名の番号がCAS番号そのもの**のものに、
 * そのCASを直に結ぶ。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-mhlw-self-links.ts [--write]
 *
 * 対象は安衛法の3区分（皮膚等障害化学物質等・がん原性物質・鉛等/四アルキル鉛等）。
 * どれも政令番号を持たず、厚労省の一覧が CAS で物質を挙げているので、
 * **法文物質名の番号に CAS を入れてある**（`docs/法規制データの作り方.md`）。
 *
 * ここまでのCASリンクは LOLI と CHRIP からしか作っておらず、
 * **その2つが持っていない物質だけリンクが空**になっていた（78件）。
 * 一覧そのものが CAS を挙げているのだから、そこから結べる。
 * EU（ECHA）・米国（CFR）で同じことをしているのと同じ考え方。
 *
 * 出どころは `MHLW`。無ければ作り、いまのバージョンに紐づける（優先順位は末尾）。
 * 何度流しても増えない。
 */
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE_CODE = "MHLW";
const SOURCE_NOTE = "厚生労働省の対象物質一覧。一覧が CAS を載せているので、そこから直に結ぶ";
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** 番号が CAS になっている区分 */
const TARGETS: { law: string; category: string }[] = [
  { law: "JP-ISHA", category: "SKIN" },
  { law: "JP-ISHA", category: "CARC30" },
  { law: "JP-ISHA", category: "LEAD" },
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
          note: "厚生労働省の対象物質一覧（皮膚等障害・がん原性物質・鉛等）",
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
        links: { none: {} },
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
