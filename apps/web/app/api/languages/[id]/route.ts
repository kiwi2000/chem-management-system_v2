import { languageSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { countLanguageUses } from "@/lib/language-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/languages/[id] */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.language.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = languageSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;

  if (v.code !== existing.code) {
    const clash = await prisma.language.findUnique({ where: { code: v.code } });
    if (clash && clash.deletedAt === null) {
      return jsonError(409, "duplicate_language_code", m.languages.duplicateCode(v.code));
    }
    // コードは法規制の側に文字列で入っているので、使われていたら変えさせない
    const uses = await countLanguageUses(existing.code);
    if (uses > 0) return jsonError(409, "referenced", m.languages.inUse(uses));
  }

  await prisma.language.update({
    where: { id },
    data: {
      code: v.code,
      nameJa: v.nameJa,
      nameEn: v.nameEn,
      displayOrder: v.displayOrder,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "languages",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  return Response.json({ ok: true });
}

/** DELETE /api/languages/[id] — 論理削除。法規制で使われているものは消せない */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.language.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  const uses = await countLanguageUses(existing.code);
  if (uses > 0) return jsonError(409, "referenced", m.languages.inUse(uses));

  await prisma.language.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: actor.user.id },
  });

  await writeAudit({
    entity: "languages",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { code: existing.code, nameJa: existing.nameJa },
  });
  return Response.json({ ok: true });
}
