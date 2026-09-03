import { feedbackCommentSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/feedback/[id]/comments — 返信を1件足す。
 *
 * 元の書き込みにも、どの返信にも（自分のものにも）返信できる。
 * 足したら書き込み本体の更新日時と更新者も動かす。一覧の並び（更新の新しい順）と
 * 未読の印は本体の更新日時で決めているので、返信が付いたことがそこに現れる
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const feedback = await prisma.feedback.findFirst({ where: { id, deletedAt: null } });
  if (!feedback) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = feedbackCommentSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  // 返信先は同じ書き込みの、消えていない返信に限る
  if (v.parentId) {
    const parent = await prisma.feedbackComment.findFirst({
      where: { id: v.parentId, feedbackId: id, deletedAt: null },
      select: { id: true },
    });
    if (!parent) return jsonError(404, "not_found", m.errors.notFound);
  }

  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.feedbackComment.create({
      data: { feedbackId: id, parentId: v.parentId, body: v.body, createdBy: actor.user.id },
    });
    await tx.feedback.update({ where: { id }, data: { updatedBy: actor.user.id } });
    return c;
  });

  await writeAudit({
    entity: "feedback_comments",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { feedbackId: id, parentId: v.parentId },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
