import { emptyTableState, parseTableState } from "@chem/shared";
import { requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { DOCUMENT_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import type { GeneratedDocumentDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 新しいものが上。作ったばかりのものをすぐ出せるように */
const DEFAULT_STATE = emptyTableState([{ column: "generatedAt", direction: "desc" }]);

/**
 * GET /api/documents — 発行済みドキュメントの一覧。
 *
 * **見えるのは自分が作ったものだけ。**他人のものを見せる必要が出たら、
 * そのときに権限を足す（最初から広く見せると、あとで狭めるのが難しい）。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    DOCUMENT_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = {
    generatedBy: actor.user.id,
    ...buildWhere(DOCUMENT_COLUMNS, state.filters),
  };

  const [items, total] = await Promise.all([
    prisma.generatedDocument.findMany({
      where,
      orderBy: buildOrderBy(DOCUMENT_COLUMNS, state.sort, { generatedAt: "desc" }),
      select: {
        id: true,
        targetCode: true,
        hasComposition: true,
        generatedAt: true,
        params: true,
        template: { select: { code: true, nameJa: true, nameEn: true, target: true } },
      },
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.generatedDocument.count({ where }),
  ]);

  return Response.json({
    items: items.map((d): GeneratedDocumentDto => ({
      id: d.id,
      templateCode: d.template.code,
      templateNameJa: d.template.nameJa,
      templateNameEn: d.template.nameEn,
      target: d.template.target,
      targetCode: d.targetCode,
      hasComposition: d.hasComposition,
      version: (d.params as { version?: string } | null)?.version ?? "",
      generatedAt: d.generatedAt.toISOString(),
    })),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}
