import { emptyTableState, parseTableState, type SortRule } from "@chem/shared";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { CAS_LINK_COLUMNS } from "@/lib/list-columns";
import { buildWhere } from "@/lib/table-query";
import type { CasLinkRowDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 既定は CAS 番号の順。法文物質名の画面の対象CASと同じ */
const DEFAULT_STATE = emptyTableState([{ column: "casNumber", direction: "asc" }]);

/**
 * 物質名で絞るときに集める CAS の上限。
 * リンクの行には名前が無いので、先に物質マスタから CAS を集めて `in` で絞る。
 * これを超えて当たる名前（「酸」など）は絞り込みとして粗すぎるので、上限で切る
 */
const CAS_NAME_LIMIT = 2000;

/**
 * 並べ替え。法文物質名の中の項目は関連をたどる（共通の buildOrderBy は直接の列だけ）。
 * 最後に CAS を足して、ページをまたいでも順序がぶれないようにする
 */
function orderByOf(sort: SortRule[]) {
  const order: Record<string, unknown>[] = [];
  for (const rule of sort) {
    const dir = rule.direction;
    switch (rule.column) {
      case "casNumber":
        order.push({ casNormalized: dir });
        break;
      case "excluded":
      case "note":
      case "updatedAt":
        order.push({ [rule.column]: dir });
        break;
      case "officialNumber":
        order.push({ statutorySubstance: { officialNumber: dir } });
        break;
      case "statutoryName":
        order.push({ statutorySubstance: { nameOriginal: dir } });
        break;
      case "className":
        order.push({ statutorySubstance: { regulationClass: { nameOriginal: dir } } });
        break;
      case "categoryId":
        order.push({
          statutorySubstance: { regulationClass: { category: { displayOrder: dir } } },
        });
        break;
      case "lawId":
        order.push({
          statutorySubstance: { regulationClass: { category: { law: { displayOrder: dir } } } },
        });
        break;
      default:
        break;
    }
  }
  if (!order.some((o) => "casNormalized" in o)) order.push({ casNormalized: "asc" });
  return order;
}

/**
 * GET /api/cas-links — 1つのバージョン × 1つのデータソースの対象CASを、法文物質名をまたいで一覧にする。
 *
 * 外部データベースの画面で、取り込んだ内容をまとめて確かめるための表。
 * 法文物質名の画面の `/api/statutory-cas-links` は法文物質名1つが前提でメモリ内で絞るので、
 * 20万行規模を相手にするこちらは**絞り込み・並べ替え・ページングをすべて DB 側**で行う。
 *
 * 「採用」（優先度で勝っているか）は、そのページの行についてだけ計算する。
 * 全件で計算すると、ページを開くたびに数十万行を読むことになる
 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  const params = new URL(req.url).searchParams;
  const versionId = params.get("versionId") ?? "";
  const sourceId = params.get("sourceId") ?? "";
  if (!versionId || !sourceId) return jsonError(400, "validation_error", m.errors.validation);

  const state = parseTableState(
    params,
    CAS_LINK_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  // 物質名（代表物質）で絞る。リンクの行には名前が無いので、先に物質マスタから CAS を集める
  const casName = state.filters.casName;
  let casScope: string[] | null = null;
  if (casName?.kind === "text" && casName.value.trim() !== "") {
    const v = casName.value.trim();
    const reps = await prisma.substance.findMany({
      where: {
        deletedAt: null,
        isCasRepresentative: true,
        casNormalized: { not: null },
        OR: [
          { nameJa: { contains: v, mode: "insensitive" } },
          { nameEn: { contains: v, mode: "insensitive" } },
        ],
      },
      select: { casNormalized: true },
      take: CAS_NAME_LIMIT,
    });
    casScope = reps.map((r) => r.casNormalized).filter((c): c is string => c !== null);
  }

  // 区分・法律の画面から来たときの範囲。表の絞り込みとは別に、URL で持ち回る
  const lawId = params.get("lawId");
  const categoryId = params.get("categoryId");
  const scope = categoryId
    ? { statutorySubstance: { regulationClass: { categoryId } } }
    : lawId
      ? { statutorySubstance: { regulationClass: { category: { lawId } } } }
      : {};

  const where = {
    versionId,
    sourceId,
    ...scope,
    ...(casScope ? { casNormalized: { in: casScope } } : {}),
    ...buildWhere(CAS_LINK_COLUMNS, state.filters),
  };

  const [rows, total, order] = await Promise.all([
    prisma.statutoryCasLink.findMany({
      where,
      orderBy: orderByOf(state.sort),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        versionId: true,
        sourceId: true,
        statutorySubstanceId: true,
        casNumber: true,
        casNormalized: true,
        excluded: true,
        note: true,
        updatedAt: true,
        source: { select: { code: true } },
        // 出どころの文章。無いリンクのほうが多いので別テーブル
        data: { select: { text: true, textJa: true } },
        statutorySubstance: {
          select: {
            officialNumber: true,
            nameOriginal: true,
            nameJa: true,
            nameEn: true,
            regulationClass: {
              select: {
                nameOriginal: true,
                nameJa: true,
                nameEn: true,
                category: {
                  select: {
                    id: true,
                    code: true,
                    nameOriginal: true,
                    nameJa: true,
                    nameEn: true,
                    law: {
                      select: {
                        id: true,
                        code: true,
                        nameOriginal: true,
                        nameJa: true,
                        nameEn: true,
                        country: {
                          select: {
                            nameJa: true,
                            nameEn: true,
                            region: { select: { nameJa: true, nameEn: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.statutoryCasLink.count({ where }),
    prisma.linkVersionSource.findMany({
      where: { versionId },
      select: { sourceId: true, priority: true },
    }),
  ]);

  /*
    「採用」は、このページの行についてだけ決める。
    同じバージョンの、より優先度の高いデータソースが同じ結び付き（法文物質名 × CAS）を
    持っていれば、この行は採られていない。法文物質名の画面と同じ規則
  */
  const rank = new Map(order.map((o) => [o.sourceId, o.priority]));
  const rankOf = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const myRank = rankOf(sourceId);
  const keyOf = (substanceId: string, cas: string) => `${substanceId}/${cas}`;
  const rivals =
    rows.length === 0 || !rank.has(sourceId)
      ? []
      : await prisma.statutoryCasLink.findMany({
          where: {
            versionId,
            sourceId: { not: sourceId },
            statutorySubstanceId: { in: [...new Set(rows.map((r) => r.statutorySubstanceId))] },
            casNormalized: { in: [...new Set(rows.map((r) => r.casNormalized))] },
          },
          select: { statutorySubstanceId: true, casNormalized: true, sourceId: true },
        });
  const beaten = new Set<string>();
  for (const l of rivals) {
    if (rankOf(l.sourceId) < myRank) beaten.add(keyOf(l.statutorySubstanceId, l.casNormalized));
  }

  // そのCASが何なのかは、物質マスタの代表物質から引く（法文物質名の画面と同じやりかた）
  const reps =
    rows.length === 0
      ? []
      : await prisma.substance.findMany({
          where: {
            deletedAt: null,
            isCasRepresentative: true,
            casNormalized: { in: [...new Set(rows.map((r) => r.casNormalized))] },
          },
          select: { id: true, casNormalized: true, nameJa: true, nameEn: true },
        });
  const nameByCas = new Map(reps.map((r) => [r.casNormalized ?? "", r]));

  const items: CasLinkRowDto[] = rows.map((l) => {
    const s = l.statutorySubstance;
    const cls = s.regulationClass;
    const cat = cls.category;
    const law = cat.law;
    const rep = nameByCas.get(l.casNormalized);
    return {
      id: l.id,
      versionId: l.versionId,
      sourceId: l.sourceId,
      sourceCode: l.source.code,
      regionNameJa: law.country.region.nameJa,
      regionNameEn: law.country.region.nameEn,
      countryNameJa: law.country.nameJa,
      countryNameEn: law.country.nameEn,
      lawId: law.id,
      lawCode: law.code,
      lawNameOriginal: law.nameOriginal,
      lawNameJa: law.nameJa,
      lawNameEn: law.nameEn,
      categoryId: cat.id,
      categoryCode: cat.code,
      categoryNameOriginal: cat.nameOriginal,
      categoryNameJa: cat.nameJa,
      categoryNameEn: cat.nameEn,
      classNameOriginal: cls.nameOriginal,
      classNameJa: cls.nameJa,
      classNameEn: cls.nameEn,
      statutorySubstanceId: l.statutorySubstanceId,
      officialNumber: s.officialNumber,
      statutoryNameOriginal: s.nameOriginal,
      statutoryNameJa: s.nameJa,
      statutoryNameEn: s.nameEn,
      casNumber: l.casNumber,
      casNormalized: l.casNormalized,
      substanceId: rep?.id ?? null,
      substanceNameJa: rep?.nameJa ?? null,
      substanceNameEn: rep?.nameEn ?? null,
      excluded: l.excluded,
      used: rank.has(sourceId) && !beaten.has(keyOf(l.statutorySubstanceId, l.casNormalized)),
      data: l.data?.text ?? null,
      dataJa: l.data?.textJa ?? null,
      note: l.note,
      updatedAt: l.updatedAt.toISOString(),
    };
  });

  return Response.json({ items, total, page: state.page, pageSize: state.pageSize });
}
