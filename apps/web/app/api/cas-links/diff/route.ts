import { emptyTableState, parseTableState, type SortRule } from "@chem/shared";
import { jsonError, requirePermission } from "@/lib/authz";
import { ensureDiffRun } from "@/lib/cas-link-diff";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { CAS_LINK_DIFF_COLUMNS } from "@/lib/list-columns";
import { buildWhere } from "@/lib/table-query";
import type { CasLinkDiffRowDto, CasLinkDiffRunDto, CasLinkSideDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 既定は 種類 → CAS の順。増えた・消えた・変わった がまとまって並ぶ */
const DEFAULT_STATE = emptyTableState([
  { column: "kind", direction: "asc" },
  { column: "casNumber", direction: "asc" },
]);

/** 物質名で絞るときに集める CAS の上限（対象CASの表と同じ） */
const CAS_NAME_LIMIT = 2000;

const KIND_OF = { ADDED: "added", REMOVED: "removed", CHANGED: "changed" } as const;

/** 並べ替え。差分の行から法文物質名の側へ掘る（対象CASの表と同じ道） */
function orderByOf(sort: SortRule[]) {
  const order: Record<string, unknown>[] = [];
  for (const rule of sort) {
    const dir = rule.direction;
    switch (rule.column) {
      case "kind":
        order.push({ kind: dir });
        break;
      case "casNumber":
        order.push({ casNormalized: dir });
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
      case "categoryName":
        order.push({
          statutorySubstance: { regulationClass: { category: { displayOrder: dir } } },
        });
        break;
      case "lawName":
        order.push({
          statutorySubstance: { regulationClass: { category: { law: { displayOrder: dir } } } },
        });
        break;
      case "countryId":
        order.push({
          statutorySubstance: {
            regulationClass: { category: { law: { country: { displayOrder: dir } } } },
          },
        });
        break;
      case "regionId":
        order.push({
          statutorySubstance: {
            regulationClass: { category: { law: { country: { region: { displayOrder: dir } } } } },
          },
        });
        break;
      default:
        break;
    }
  }
  if (!order.some((o) => "casNormalized" in o)) order.push({ casNormalized: "asc" });
  return order;
}

const SIDE_SELECT = {
  casNumber: true,
  excluded: true,
  note: true,
  updatedAt: true,
  data: { select: { text: true, textJa: true } },
} as const;

type Side = {
  casNumber: string;
  excluded: boolean;
  note: string | null;
  updatedAt: Date;
  data: { text: string; textJa: string | null } | null;
};

const sideOf = (l: Side | null): CasLinkSideDto | null =>
  l
    ? {
        excluded: l.excluded,
        data: l.data?.text ?? null,
        dataJa: l.data?.textJa ?? null,
        note: l.note,
        updatedAt: l.updatedAt.toISOString(),
      }
    : null;

/**
 * GET /api/cas-links/diff — 1つのバージョン × 1つのデータソースの対象CASを、別の版と突き合わせた差分。
 *
 * 外部データベースの「対象CAS」の表の差分モード。行は 増えた・消えた・変わった だけ。
 * 差分そのものは `ensureDiffRun` が表に作っておき、ここはそれを絞り込み・並べ替え・ページングして返す。
 * 消えた行は今の版に無いので、比べた版の中身（該非・出典データ）を持たせる
 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  const params = new URL(req.url).searchParams;
  const versionId = params.get("versionId") ?? "";
  const sourceId = params.get("sourceId") ?? "";
  const againstId = params.get("againstId") ?? "";
  if (!versionId || !sourceId || !againstId || versionId === againstId) {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const [against, sourceInAgainst] = await Promise.all([
    prisma.linkSetVersion.findFirst({
      where: { id: againstId, deletedAt: null },
      select: { code: true },
    }),
    prisma.linkVersionSource.findFirst({
      where: { versionId: againstId, sourceId },
      select: { id: true },
    }),
  ]);
  if (!against) return jsonError(404, "not_found", m.errors.notFound);

  const run = await ensureDiffRun(versionId, againstId, sourceId);

  const state = parseTableState(
    params,
    CAS_LINK_DIFF_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  // 物質名（代表物質）で絞る。差分の行には名前が無いので、先に物質マスタから CAS を集める
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

  // 区分・法律の画面から来たときの範囲（対象CASの表と同じ）
  const lawId = params.get("lawId");
  const categoryId = params.get("categoryId");
  const scope = categoryId
    ? { statutorySubstance: { regulationClass: { categoryId } } }
    : lawId
      ? { statutorySubstance: { regulationClass: { category: { lawId } } } }
      : {};

  const where = {
    versionId,
    againstId,
    sourceId,
    ...scope,
    ...(casScope ? { casNormalized: { in: casScope } } : {}),
    ...buildWhere(CAS_LINK_DIFF_COLUMNS, state.filters),
  };

  const [rows, total, source] = await Promise.all([
    prisma.statutoryCasLinkDiff.findMany({
      where,
      orderBy: orderByOf(state.sort),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: {
        id: true,
        kind: true,
        statutorySubstanceId: true,
        casNormalized: true,
        currentLink: { select: SIDE_SELECT },
        previousLink: { select: SIDE_SELECT },
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
    prisma.statutoryCasLinkDiff.count({ where }),
    prisma.source.findUnique({ where: { id: sourceId }, select: { code: true } }),
  ]);

  // そのCASが何なのかは、物質マスタの代表物質から引く
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

  const items: CasLinkDiffRowDto[] = rows.map((d) => {
    const s = d.statutorySubstance;
    const cls = s.regulationClass;
    const cat = cls.category;
    const law = cat.law;
    const rep = nameByCas.get(d.casNormalized);
    // 表の通常の項目は今の版から。消えたものは今の版に無いので、比べた版のもので埋める
    const shown = d.currentLink ?? d.previousLink;
    return {
      id: d.id,
      kind: KIND_OF[d.kind],
      current: sideOf(d.currentLink),
      previous: sideOf(d.previousLink),
      versionId,
      sourceId,
      sourceCode: source?.code ?? "",
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
      statutorySubstanceId: d.statutorySubstanceId,
      officialNumber: s.officialNumber,
      statutoryNameOriginal: s.nameOriginal,
      statutoryNameJa: s.nameJa,
      statutoryNameEn: s.nameEn,
      casNumber: shown?.casNumber ?? d.casNormalized,
      casNormalized: d.casNormalized,
      substanceId: rep?.id ?? null,
      substanceNameJa: rep?.nameJa ?? null,
      substanceNameEn: rep?.nameEn ?? null,
      excluded: shown?.excluded ?? false,
      // 差分の表では「採用」は見ない
      used: false,
      data: shown?.data?.text ?? null,
      dataJa: shown?.data?.textJa ?? null,
      note: shown?.note ?? null,
      updatedAt: (shown?.updatedAt ?? new Date()).toISOString(),
    };
  });

  const summary: CasLinkDiffRunDto = {
    added: run.added,
    removed: run.removed,
    changed: run.changed,
    computedAt: run.computedAt.toISOString(),
    againstCode: against.code,
    sourceInAgainst: sourceInAgainst !== null,
  };
  return Response.json({ items, total, page: state.page, pageSize: state.pageSize, run: summary });
}
