import { elementSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, STAMP_SELECT, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ symbol: string }> };

/**
 * PUT /api/elements/[symbol] — 書き換え。
 * 元素記号はキーなので変えられない（換算係数がこの記号で結び付いているため）。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { symbol } = await params;
  const m = await getServerMessages();

  const existing = await prisma.element.findUnique({ where: { symbol } });
  if (!existing) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = elementSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // 楽観的ロックの印。無ければ 400
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;
  if (v.symbol !== symbol) return jsonError(409, "immutable", m.elements.duplicateSymbol(v.symbol));

  const clash = async () => {
    if (v.atomicNumber === existing.atomicNumber) return null;
    const other = await prisma.element.findUnique({ where: { atomicNumber: v.atomicNumber } });
    return other ? jsonError(409, "duplicate", m.elements.duplicateNumber(v.atomicNumber)) : null;
  };
  const clashed = await clash();
  if (clashed) return clashed;

  // 印が合う行だけを更新する。当たらなければ、ほかの人が先に保存している。
  // 同じ番号へほぼ同時に直されたら、一意の決まりで止まる。そのときもいつもの文で返す
  const hit = await guardUnique(m, clash, () =>
    prisma.element.updateMany({
      where: { symbol, ...stampWhere(lock) },
      data: {
        atomicNumber: v.atomicNumber,
        nameJa: v.nameJa,
        nameEn: v.nameEn,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (hit instanceof Response) return hit;
  if (hit.count === 0) {
    return staleFromRow(
      m,
      await prisma.element.findUnique({ where: { symbol }, select: STAMP_SELECT }),
    );
  }

  await writeAudit({
    entity: "elements",
    entityId: symbol,
    action: "update",
    actorId: actor.user.id,
    diff: { symbol, nameJa: v.nameJa },
  });
  const after = await prisma.element.findUniqueOrThrow({
    where: { symbol },
    select: { updatedAt: true },
  });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}
