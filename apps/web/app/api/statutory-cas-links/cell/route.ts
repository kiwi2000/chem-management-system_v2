import { normalizeCas } from "@chem/shared";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import type { CellDetailDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/statutory-cas-links/cell?cas=...&categoryId=...
 *
 * 1つの CAS × 1つの規制区分について、**バージョンごと・データソースごと**に
 * どの法文物質名に結び付いているかを返す。まとめ表のセルを押したときに開く。
 *
 * **バージョンによってデータソースの並びも顔ぶれも違う。**
 * 前のバージョンには無かったデータソースが増えていることも、逆もある。
 * だからバージョンごとに、そのバージョンの並びで返す。
 *
 * 「採用」は**優先度がいちばん高いものが勝つ**（CASリンク画面の「使用」と同じ）。
 * 同じ法文物質名を2つのデータソースが持っていれば、優先度の高いほうだけが採用になる。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  const params = new URL(req.url).searchParams;
  const casRaw = params.get("cas") ?? "";
  const categoryId = params.get("categoryId") ?? "";
  const cas = normalizeCas(casRaw);
  if (!cas || !categoryId) return jsonError(400, "validation_error", m.errors.validation);

  const category = await prisma.regulationCategory.findFirst({
    where: { id: categoryId, deletedAt: null },
    select: {
      nameJa: true,
      nameEn: true,
      nameOriginal: true,
      law: { select: { nameJa: true, nameEn: true, nameOriginal: true } },
    },
  });
  if (!category) return jsonError(404, "not_found", m.errors.notFound);

  // 物質マスタの見出し。CAS を持つ代表の1件を出す
  const substance = await prisma.substance.findFirst({
    where: { deletedAt: null, casNormalized: cas },
    orderBy: [{ isCasRepresentative: "desc" }, { code: "asc" }],
    select: { code: true, casNumber: true, nameJa: true, nameEn: true },
  });

  const versions = await prisma.linkSetVersion.findMany({
    where: { deletedAt: null },
    orderBy: { code: "desc" },
    select: { id: true, code: true, isCurrent: true },
  });

  const out: CellDetailDto["versions"] = [];
  for (const v of versions) {
    /*
      そのバージョンのデータソースを、**そのバージョンの優先度の順**に出す。
      バージョンをまたいで並びを揃えると、優先度が変わったことが見えなくなる
    */
    const defs = await prisma.linkVersionSource.findMany({
      where: { versionId: v.id },
      orderBy: { priority: "asc" },
      select: { source: { select: { id: true, code: true, color: true } } },
    });

    const links = await prisma.statutoryCasLink.findMany({
      where: {
        versionId: v.id,
        casNormalized: cas,
        excluded: false,
        statutorySubstance: { deletedAt: null, regulationClass: { categoryId } },
      },
      select: {
        sourceId: true,
        statutorySubstance: {
          select: {
            id: true,
            officialNumber: true,
            nameJa: true,
            nameEn: true,
            nameOriginal: true,
            displayOrder: true,
            regulationClass: {
              select: { nameJa: true, nameEn: true, nameOriginal: true },
            },
          },
        },
      },
    });

    /*
      **採用は法文物質名ごとに決める。**データソースAが号1を、データソースBが号2を
      持っていれば、どちらも判定に効いている。同じ号を2つが持っているときだけ、
      優先度の高いほうが勝つ
    */
    const rank = new Map(defs.map((d, i) => [d.source.id, i]));
    const best = new Map<string, number>();
    for (const l of links) {
      const at = rank.get(l.sourceId) ?? 99;
      const now = best.get(l.statutorySubstance.id);
      if (now === undefined || at < now) best.set(l.statutorySubstance.id, at);
    }

    out.push({
      code: v.code,
      isCurrent: v.isCurrent,
      sources: defs.map((d) => ({
        id: d.source.id,
        code: d.source.code,
        color: d.source.color,
        items: links
          .filter((l) => l.sourceId === d.source.id)
          .sort((a, b) => a.statutorySubstance.displayOrder - b.statutorySubstance.displayOrder)
          .map((l) => ({
            classNameJa: l.statutorySubstance.regulationClass.nameJa,
            classNameEn: l.statutorySubstance.regulationClass.nameEn,
            classNameOriginal: l.statutorySubstance.regulationClass.nameOriginal,
            officialNumber: l.statutorySubstance.officialNumber,
            nameJa: l.statutorySubstance.nameJa,
            nameEn: l.statutorySubstance.nameEn,
            nameOriginal: l.statutorySubstance.nameOriginal,
            adopted: best.get(l.statutorySubstance.id) === (rank.get(d.source.id) ?? 99),
          })),
      })),
    });
  }

  const body: CellDetailDto = {
    cas: substance?.casNumber ?? casRaw,
    substanceCode: substance?.code ?? null,
    substanceNameJa: substance?.nameJa ?? null,
    substanceNameEn: substance?.nameEn ?? null,
    lawNameJa: category.law.nameJa,
    lawNameEn: category.law.nameEn,
    lawNameOriginal: category.law.nameOriginal,
    categoryNameJa: category.nameJa,
    categoryNameEn: category.nameEn,
    categoryNameOriginal: category.nameOriginal,
    versions: out,
  };
  return Response.json(body);
}
