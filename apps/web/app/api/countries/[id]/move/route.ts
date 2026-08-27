import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { COUNTRY_ORDER_BY } from "@/lib/law-order";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/countries/[id]/move — 並べ替え。
 * body: { targetId } … その国の位置へ移す。
 *
 * **同じ地域の中だけ。**国の表は地域ごとにまとまって並ぶので、
 * 別の地域の国の隣へ落としても、その位置には出られない。
 * 地域をまたいで動かしたいときは、国の「地域」を直す。
 *
 * ここを入れ替えると、法令の表でもその国の法令がまとまって動く。
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
    prisma.country.findFirst({ where: { id, deletedAt: null } }),
    prisma.country.findFirst({ where: { id: targetId, deletedAt: null } }),
  ]);
  if (!moving || !target) return jsonError(404, "not_found", m.errors.notFound);
  if (moving.regionId !== target.regionId) {
    return jsonError(409, "different_region", m.countries.sameRegionOnly);
  }
  if (moving.id === target.id) return Response.json({ ok: true });

  const rows = await prisma.country.findMany({
    where: { regionId: moving.regionId, deletedAt: null },
    orderBy: [...COUNTRY_ORDER_BY],
    select: { id: true },
  });

  const order = rows.map((r) => r.id).filter((x) => x !== moving.id);
  order.splice(order.indexOf(target.id), 0, moving.id);

  await prisma.$transaction(
    order.map((rowId, i) =>
      prisma.country.update({
        where: { id: rowId },
        data: { displayOrder: (i + 1) * 10, updatedBy: actor.user.id },
      }),
    ),
  );

  return Response.json({ ok: true });
}
