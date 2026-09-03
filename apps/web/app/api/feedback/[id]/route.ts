import { feedbackStateSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { toCommentDtos, toFeedbackDtos } from "@/lib/feedback-service";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/feedback/[id] — 書き込みと、その返信すべて */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;

  const item = await prisma.feedback.findFirst({ where: { id, deletedAt: null } });
  if (!item) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  const comments = await prisma.feedbackComment.findMany({
    where: { feedbackId: id },
    orderBy: { createdAt: "asc" },
  });
  const [dto] = await toFeedbackDtos([item], {
    seenAt: actor.user.feedbackSeenAt,
    viewerId: actor.user.id,
  });
  return Response.json({
    item: dto,
    comments: await toCommentDtos(comments, { id: actor.user.id, isAdmin: actor.has("ADMIN") }),
  });
}

/**
 * PUT /api/feedback/[id] — 種別・重要度・ステータスだけを直す。
 * **タイトルと内容は直さない。**言い足すことは返信で書く（書いた後で中身が変わると、
 * その下の返信が何に対するものか分からなくなる）。
 * 書いた本人でなくても動かせる。対応の状況を進めるのは受け取った側だからで、
 * ここを本人だけにすると、状態を進められる人がいなくなる。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.feedback.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = feedbackStateSchema().safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  await prisma.feedback.update({
    where: { id },
    data: { ...v, updatedBy: actor.user.id },
  });

  await writeAudit({
    entity: "feedbacks",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { kind: v.kind, priority: v.priority, status: v.status },
  });
  return Response.json({ ok: true });
}

/** DELETE /api/feedback/[id] — 論理削除 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.feedback.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  await prisma.feedback.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: actor.user.id },
  });

  await writeAudit({
    entity: "feedbacks",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { title: existing.title },
  });
  return Response.json({ ok: true });
}
