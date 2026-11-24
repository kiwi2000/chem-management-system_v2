import { normalizeCode, regulationClassSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/regulation-classes/[id] — 名前と並び順を直す */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.regulationClass.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

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
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  // 自分自身とは重ならない
  const clash = async () => {
    const other = await prisma.regulationClass.findFirst({
      where: { categoryId: existing.categoryId, codeNormalized, deletedAt: null, id: { not: id } },
    });
    return other
      ? jsonError(409, "duplicate_class_code", m.regulationClasses.duplicateCode(v.code))
      : null;
  };
  if (codeNormalized !== existing.codeNormalized) {
    const clashed = await clash();
    if (clashed) return clashed;
  }

  // 同じコードへほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const hit = await guardUnique(m, clash, () =>
    prisma.regulationClass.updateMany({
      where: { id, ...stampWhere(lock) },
      data: {
        code: v.code,
        codeNormalized,
        nameOriginal: v.nameOriginal ?? null,
        nameLang: v.nameLang ?? null,
        nameJa: v.nameJa ?? null,
        nameEn: v.nameEn ?? null,
        displayOrder: v.displayOrder,
        interactionGroup: v.interactionGroup ?? null,
        rank: v.rank ?? null,
        note: v.note ?? null,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.regulationClass.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }

  await writeAudit({
    entity: "regulation_classes",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal ?? null },
  });
  const after = await prisma.regulationClass.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}
