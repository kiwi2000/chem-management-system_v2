import { impurityTypeSchema, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/impurity-types/[id] — 名前・説明の変更（組み込みも名前は変えられる） */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.impurityType.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = impurityTypeSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  // 組み込みのコードは判定の既定値に使っているので変えさせない（名前と説明は変えられる）
  if (existing.builtin && codeNormalized !== existing.codeNormalized) {
    return jsonError(409, "builtin", m.impurityTypes.builtinCode);
  }
  const clash = async () => {
    if (codeNormalized === existing.codeNormalized) return null;
    const dup = await prisma.impurityType.findFirst({ where: { codeNormalized } });
    return dup ? jsonError(409, "duplicate", m.impurityTypes.duplicateCode(v.code)) : null;
  };
  const clashed = await clash();
  if (clashed) return clashed;

  // 同じコードへほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const hit = await guardUnique(m, clash, () =>
    prisma.impurityType.updateMany({
      where: { id, ...stampWhere(lock) },
      data: {
        code: v.code,
        codeNormalized,
        nameJa: v.nameJa,
        nameEn: v.nameEn ?? null,
        note: v.note ?? null,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.impurityType.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }

  await writeAudit({
    entity: "impurity_types",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  const after = await prisma.impurityType.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ id, stamp: rowStamp(after) });
}
