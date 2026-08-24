import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/link-version-sources/[id]/move — 並べ替え。
 * body: { targetId } … その行の位置へ移す。
 *
 * 優先度の数字は画面に出さず、**並んでいる順そのもの**が順位になる。
 * 動かしたあとに 1 から振り直すので、番号が飛んだり重なったりしない。
 *
 * 同じバージョンの中だけ。別のバージョンの行へは落とせない
 * （データソースの持ち主が変わってしまうため）。
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
    prisma.linkVersionSource.findUnique({ where: { id } }),
    prisma.linkVersionSource.findUnique({ where: { id: targetId } }),
  ]);
  if (!moving || !target) return jsonError(404, "not_found", m.errors.notFound);
  if (moving.versionId !== target.versionId) {
    return jsonError(409, "different_version", m.dataSources.sameVersionOnly);
  }
  if (moving.id === target.id) return Response.json({ ok: true });

  const rows = await prisma.linkVersionSource.findMany({
    where: { versionId: moving.versionId },
    orderBy: { priority: "asc" },
    select: { id: true },
  });

  // 抜いてから、落とし先の位置へ差し込む
  const order = rows.map((r) => r.id).filter((x) => x !== moving.id);
  order.splice(order.indexOf(target.id), 0, moving.id);

  /*
    「同じバージョンで同じ優先度は1つだけ」という制約があるので、
    そのまま順に書き換えると途中でぶつかる。
    いったん全部を空き番号（1000番台）へ逃がしてから、1 から振り直す。
  */
  await prisma.$transaction([
    ...order.map((rowId, i) =>
      prisma.linkVersionSource.update({ where: { id: rowId }, data: { priority: 1000 + i } }),
    ),
    ...order.map((rowId, i) =>
      prisma.linkVersionSource.update({
        where: { id: rowId },
        data: { priority: i + 1, updatedBy: actor.user.id },
      }),
    ),
  ]);

  return Response.json({ ok: true });
}
