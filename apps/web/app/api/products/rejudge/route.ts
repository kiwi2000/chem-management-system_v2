import { productRejudgeSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { judgeProduct, loadFactors, loadRules } from "@/lib/judge-store";
import { visibilityWhere } from "@/lib/product-service";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/products/rejudge — 選んだ製品だけを判定し直す（2026-09-18 指示）。
 *
 * 全製品のやり直し（管理者の「全製品を判定し直す」）を待たずに、
 * 手元の製品だけ新しい前提（データソースの有効／無効・閾値・結び付き）で判定するためのもの。
 * 製品を編集できる人なら押せる。組成を保存したときと同じ計算で、展開は作り直さない
 * （組成は変わっていないので）。
 *
 * その場で回して返す。数は公開の一括操作と同じ上限（500件）
 */
export async function POST(req: Request) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = productRejudgeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const ids = [...new Set(parsed.data.ids)];

  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) return jsonError(409, "no_version", m.errors.notFound);

  // 見えない製品（非公開・他人の作成中）は飛ばす。一覧に出ていないものを名指しされても判定しない
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, deletedAt: null, ...visibilityWhere(actor) },
    select: { id: true },
  });

  // 法律側の決めごとは1回だけ読んで使い回す
  const [rules, factors, settings] = await Promise.all([
    loadRules(version.id),
    loadFactors(),
    getAppSettings(),
  ]);
  for (const p of products) {
    await judgeProduct(p.id, rules, factors, settings.conditionalLinkMode, version.id);
  }

  await writeAudit({
    entity: "products",
    action: "determine",
    actorId: actor.user.id,
    diff: { rejudged: products.length, requested: ids.length, version: version.code },
  });
  return Response.json({ requested: ids.length, judged: products.length });
}
