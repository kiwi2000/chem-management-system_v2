import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { LAW_ORDER_BY } from "@/lib/law-order";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/laws/[id]/move — 並べ替え。
 * body: { targetId } … その法律の位置へ移す。
 *
 * **表示順の数字は打たない。**画面に並んでいる順そのものが表示順になる。
 * 動かしたあとに 10 刻みで振り直すので、番号が飛んだり重なったりしない。
 *
 * **同じ国の中だけ。**並びは 地域 → 国 → 法律 の順で決まるので、
 * 別の国の法律の隣へ落としても、その位置には出られない
 * （出られない場所へ落とせると、動かしたのに動かないように見える）。
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
    prisma.law.findFirst({ where: { id, deletedAt: null } }),
    prisma.law.findFirst({ where: { id: targetId, deletedAt: null } }),
  ]);
  if (!moving || !target) return jsonError(404, "not_found", m.errors.notFound);
  if (moving.countryId !== target.countryId) {
    return jsonError(409, "different_country", m.laws.sameCountryOnly);
  }
  if (moving.id === target.id) return Response.json({ ok: true });

  const rows = await prisma.law.findMany({
    where: { countryId: moving.countryId, deletedAt: null },
    orderBy: [...LAW_ORDER_BY],
    select: { id: true },
  });

  // 抜いてから、落とし先の位置へ差し込む
  const order = rows.map((r) => r.id).filter((x) => x !== moving.id);
  order.splice(order.indexOf(target.id), 0, moving.id);

  /*
    10 刻みにする。あとから1件だけ手で割り込ませたくなったときに、
    全部を振り直さずに済む
  */
  await prisma.$transaction(
    order.map((rowId, i) =>
      prisma.law.update({
        where: { id: rowId },
        data: { displayOrder: (i + 1) * 10, updatedBy: actor.user.id },
      }),
    ),
  );

  return Response.json({ ok: true });
}
