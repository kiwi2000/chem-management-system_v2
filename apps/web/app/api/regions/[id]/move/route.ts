import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { REGION_ORDER_BY } from "@/lib/law-order";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/regions/[id]/move — 並べ替え。
 * body: { targetId } … その地域の位置へ移す。
 *
 * **地域の順は下まで効く。**国は地域ごとにまとまって並び、法律は国ごとに
 * まとまって並ぶので、ここを入れ替えると国の表も法律の表もまとめて動く。
 * 数字は打たず、動かしたあとに 10 刻みで振り直す。
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
    prisma.region.findFirst({ where: { id, deletedAt: null } }),
    prisma.region.findFirst({ where: { id: targetId, deletedAt: null } }),
  ]);
  if (!moving || !target) return jsonError(404, "not_found", m.errors.notFound);
  if (moving.id === target.id) return Response.json({ ok: true });

  const rows = await prisma.region.findMany({
    where: { deletedAt: null },
    orderBy: [...REGION_ORDER_BY],
    select: { id: true },
  });

  // 抜いてから、落とし先の位置へ差し込む
  const order = rows.map((r) => r.id).filter((x) => x !== moving.id);
  order.splice(order.indexOf(target.id), 0, moving.id);

  await prisma.$transaction(
    order.map((rowId, i) =>
      prisma.region.update({
        where: { id: rowId },
        data: { displayOrder: (i + 1) * 10, updatedBy: actor.user.id },
      }),
    ),
  );

  return Response.json({ ok: true });
}
