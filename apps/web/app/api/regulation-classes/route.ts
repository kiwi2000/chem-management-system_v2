import { normalizeCode, regulationClassSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { CLASS_INCLUDE, toClassDto } from "@/lib/law-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/regulation-classes?categoryId=... — その区分の分類を並び順で全部返す。
 * 数は多くても数個なので、絞り込みも改ページも持たない。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  const categoryId = new URL(req.url).searchParams.get("categoryId");
  if (!categoryId) return jsonError(400, "validation_error", m.errors.validation);

  const items = await prisma.regulationClass.findMany({
    where: { categoryId, deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    include: CLASS_INCLUDE,
  });
  return Response.json({ items: items.map(toClassDto) });
}

/** POST /api/regulation-classes — 分類を1件足す */
export async function POST(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = regulationClassSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const category = await prisma.regulationCategory.findFirst({
    where: { id: v.categoryId, deletedAt: null },
  });
  if (!category) return jsonError(404, "not_found", m.errors.notFound);

  const live = await prisma.regulationClass.findFirst({
    where: { categoryId: v.categoryId, codeNormalized, deletedAt: null },
  });
  if (live) {
    return jsonError(409, "duplicate_class_code", m.regulationClasses.duplicateCode(v.code));
  }

  const created = await prisma.regulationClass.create({
    data: {
      code: v.code,
      codeNormalized,
      categoryId: v.categoryId,
      nameOriginal: v.nameOriginal ?? null,
      nameLang: v.nameLang ?? null,
      nameJa: v.nameJa ?? null,
      nameEn: v.nameEn ?? null,
      displayOrder: v.displayOrder,
      interactionGroup: v.interactionGroup ?? null,
      rank: v.rank ?? null,
      note: v.note ?? null,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "regulation_classes",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal ?? null, categoryId: v.categoryId },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
