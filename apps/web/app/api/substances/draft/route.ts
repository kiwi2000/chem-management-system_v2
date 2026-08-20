import { draftUpdateSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { canEditSubstance, visibilityWhere } from "@/lib/substance-service";

export const dynamic = "force-dynamic";

/** POST /api/substances/draft — 作成中／完成を切り替える（製品と同じ扱い） */
export async function POST(req: Request) {
  const m = await getServerMessages();
  const actor = await requirePermission("SUBSTANCE_EDIT");
  if (actor instanceof Response) return actor;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = draftUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { ids, draftFlag } = parsed.data;

  const targets = await prisma.substance.findMany({
    where: { id: { in: ids }, deletedAt: null, ...visibilityWhere(actor) },
    select: { id: true, code: true, draftFlag: true, createdBy: true },
  });
  const allowed = targets.filter((t) => canEditSubstance(actor, t));
  if (allowed.length === 0) return jsonError(403, "forbidden", m.errors.forbidden);

  await prisma.substance.updateMany({
    where: { id: { in: allowed.map((t) => t.id) } },
    data: { draftFlag, updatedBy: actor.user.id },
  });

  for (const t of allowed) {
    await writeAudit({
      entity: "substances",
      entityId: t.id,
      action: "update",
      actorId: actor.user.id,
      diff: { code: t.code, draftFlag },
    });
  }

  return Response.json({ ok: true, updated: allowed.length, requested: ids.length });
}
