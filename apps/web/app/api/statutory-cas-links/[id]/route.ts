import { normalizeCas, statutoryCasLinkSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/statutory-cas-links/[id] — 直す。バージョンと法文物質名は動かさない */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const existing = await prisma.statutoryCasLink.findUnique({ where: { id } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = statutoryCasLinkSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // ほかの人が先に保存していないか（楽観的ロック）
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  const source = await prisma.source.findFirst({ where: { id: v.sourceId, deletedAt: null } });
  if (!source) return jsonError(404, "not_found", m.errors.notFound);

  const casNormalized = normalizeCas(v.casNumber);
  const clash = async () => {
    const dup = await prisma.statutoryCasLink.findFirst({
      where: {
        versionId: existing.versionId,
        statutorySubstanceId: existing.statutorySubstanceId,
        casNormalized,
        sourceId: v.sourceId,
        id: { not: id },
      },
    });
    return dup ? jsonError(409, "duplicate", m.casLinks.duplicate) : null;
  };
  const clashed = await clash();
  if (clashed) return clashed;

  // 同じリンクへほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const hit = await guardUnique(m, clash, () =>
    prisma.statutoryCasLink.updateMany({
      where: { id, ...stampWhere(lock) },
      data: {
        sourceId: v.sourceId,
        casNumber: v.casNumber,
        casNormalized,
        excluded: v.excluded,
        note: v.note ?? null,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.statutoryCasLink.findUnique({ where: { id }, select: STAMP_SELECT }),
    );
  }

  await writeAudit({
    entity: "statutory_cas_links",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      casNumber: { from: existing.casNumber, to: v.casNumber },
      excluded: { from: existing.excluded, to: v.excluded },
    },
  });

  const after = await prisma.statutoryCasLink.findUniqueOrThrow({
    where: { id },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}
