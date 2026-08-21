import { emptyTableState, feedbackSchema, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { toFeedbackDtos } from "@/lib/feedback-service";
import { getServerMessages } from "@/lib/i18n";
import { FEEDBACK_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 既定は更新の新しい順。直したものが上に来るほうが追いやすい */
const DEFAULT_STATE = emptyTableState([{ column: "updatedAt", direction: "desc" }]);

/**
 * GET /api/feedback — 一覧。
 * 開発中の窓口なので、ログインしていれば誰でも読める（権限では絞らない）。
 */
export async function GET(req: Request) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    FEEDBACK_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  const where = { deletedAt: null, ...buildWhere(FEEDBACK_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: buildOrderBy(FEEDBACK_COLUMNS, state.sort, { updatedAt: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.feedback.count({ where }),
  ]);

  return Response.json({
    items: await toFeedbackDtos(items),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/** POST /api/feedback — 追加 */
export async function POST(req: Request) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = feedbackSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  const created = await prisma.feedback.create({
    data: { ...v, createdBy: actor.user.id, updatedBy: actor.user.id },
  });

  await writeAudit({
    entity: "feedbacks",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { title: v.title, kind: v.kind, priority: v.priority, status: v.status },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
