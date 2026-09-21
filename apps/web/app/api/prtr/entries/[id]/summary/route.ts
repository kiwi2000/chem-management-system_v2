import { parseTableState } from "@chem/shared";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { summarizeEntry } from "@/lib/prtr-service";
import {
  pageSummaryRows,
  PRTR_SUMMARY_COLUMNS,
  PRTR_SUMMARY_DEFAULT_STATE,
} from "@/lib/prtr-summary-table";
import type { PrtrSummaryDto } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/prtr/entries/[id]/summary — 第一種指定化学物質ごとの集計（S22）。
 * 保存せず、そのつど計算する。絞り込み・並べ替え・ページ送りは手元の行に当てる
 */
export async function GET(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();
  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;

  const state = parseTableState(
    new URL(req.url).searchParams,
    PRTR_SUMMARY_COLUMNS,
    PRTR_SUMMARY_DEFAULT_STATE,
  );
  const { rows, ...meta } = await summarizeEntry(entry);
  const body: PrtrSummaryDto = {
    ...meta,
    ...pageSummaryRows(rows, state),
    page: state.page,
    pageSize: state.pageSize,
  };
  return Response.json(body);
}
