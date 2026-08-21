import { feedbackSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { toFeedbackDtos } from "@/lib/feedback-service";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/feedback/[id] */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;

  const item = await prisma.feedback.findFirst({ where: { id, deletedAt: null } });
  if (!item) {
    const m = await getServerMessages();
    return jsonError(404, "not_found", m.errors.notFound);
  }
  const [dto] = await toFeedbackDtos([item]);
  return Response.json({ item: dto });
}

/**
 * PUT /api/feedback/[id] — 書き換え。
 * 書いた本人でなくても直せる。対応の状況を書き込むのは受け取った側だからで、
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
  const parsed = feedbackSchema(m).safeParse(body);
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
    diff: { title: v.title, kind: v.kind, priority: v.priority, status: v.status },
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
