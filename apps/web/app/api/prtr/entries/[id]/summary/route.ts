import { emptyTableState, parseTableState } from "@chem/shared";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRTR_SUMMARY_COLUMNS } from "@/lib/list-columns";
import {
  summarizeEntry,
  summaryDiffers,
  SUMMARY_HEAD_INCLUDE,
  SUMMARY_ROW_INCLUDE,
  toSummaryMeta,
  toSummaryRowDto,
} from "@/lib/prtr-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { PrtrSummaryDto } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 既定は法文物質名の表示順（＝管理番号の数の順）。番号の列で並べると文字の順になるので、既定には使わない */
const DEFAULT_STATE = emptyTableState([]);
const DISPLAY_ORDER = { statutorySubstance: { displayOrder: "asc" as const } };

async function scopedEntry(id: string) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;
  return { actor, entry };
}

/** POST /api/prtr/entries/[id]/summary — いまの集計を作り直す（S22）。保存した集計は触らない */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = await scopedEntry(id);
  if (s instanceof Response) return s;
  const meta = await summarizeEntry(s.entry, s.actor.user.id);
  const summary = await prisma.prtrSummary.findUniqueOrThrow({ where: { entryId: id } });
  meta.unsavedChanges = await summaryDiffers(summary.id, summary.savedAt);
  return Response.json(meta);
}

/**
 * GET /api/prtr/entries/[id]/summary?saved=1 — 集計の一覧（絞り込み・並べ替え・ページ送り）。
 * 既定はいまの集計。`saved=1` で保存した集計（未確定・確定）の行
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = await scopedEntry(id);
  if (s instanceof Response) return s;

  const url = new URL(req.url);
  const saved = url.searchParams.get("saved") === "1";
  const summary = await prisma.prtrSummary.findUnique({
    where: { entryId: id },
    include: SUMMARY_HEAD_INCLUDE,
  });
  const state = parseTableState(
    url.searchParams,
    PRTR_SUMMARY_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  if (!summary) {
    const empty: PrtrSummaryDto = {
      items: [],
      total: 0,
      page: state.page,
      pageSize: state.pageSize,
      summary: null,
    };
    return Response.json(empty);
  }
  const where = {
    AND: [buildWhere(PRTR_SUMMARY_COLUMNS, state.filters)],
    summaryId: summary.id,
    saved,
  };
  const [items, total, meta] = await Promise.all([
    prisma.prtrSummaryRow.findMany({
      where,
      orderBy: [...buildOrderBy(PRTR_SUMMARY_COLUMNS, state.sort, DISPLAY_ORDER), { id: "asc" }],
      include: SUMMARY_ROW_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.prtrSummaryRow.count({ where }),
    (async () => {
      const x = toSummaryMeta(summary);
      x.unsavedChanges = await summaryDiffers(summary.id, summary.savedAt);
      return x;
    })(),
  ]);
  const body: PrtrSummaryDto = {
    items: items.map(toSummaryRowDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
    summary: meta,
  };
  return Response.json(body);
}
