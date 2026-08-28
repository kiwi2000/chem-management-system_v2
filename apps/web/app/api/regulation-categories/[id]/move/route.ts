import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/regulation-categories/[id]/move — 並べ替え。
 * body: { targetId } … その区分の位置へ移す。
 *
 * 法律の並べ替え（`/api/laws/[id]/move`）と同じ考えかた。
 * **表示順の数字は打たず、並んでいる順そのものが表示順になる。**
 *
 * **同じ法律の中だけ。**区分は法律にぶら下がっているので、
 * 別の法律の区分の隣へは出られない。
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const targetId = (body as { targetId?: unknown })?.targetId;
  if (typeof targetId !== "string" || targetId === "") {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const [moving, target] = await Promise.all([
    prisma.regulationCategory.findFirst({ where: { id, deletedAt: null } }),
    prisma.regulationCategory.findFirst({ where: { id: targetId, deletedAt: null } }),
  ]);
  if (!moving || !target) return jsonError(404, "not_found", m.errors.notFound);
  if (moving.lawId !== target.lawId) {
    return jsonError(409, "different_law", m.laws.sameLawOnly);
  }
  if (moving.id === target.id) return Response.json({ ok: true });

  const rows = await prisma.regulationCategory.findMany({
    where: { lawId: moving.lawId, deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    select: { id: true },
  });

  const order = rows.map((r) => r.id).filter((x) => x !== moving.id);
  order.splice(order.indexOf(target.id), 0, moving.id);

  await prisma.$transaction(
    order.map((rowId, i) =>
      prisma.regulationCategory.update({
        where: { id: rowId },
        data: { displayOrder: (i + 1) * 10, updatedBy: actor.user.id },
      }),
    ),
  );

  return Response.json({ ok: true });
}
