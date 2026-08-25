import { requireAdmin } from "@/lib/authz";
import { listAuditLogs } from "@/lib/audit-list";
import { prisma } from "@/lib/db";
import type { AccessLogDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * データが外へ出る操作。
 * いまは組成を見たこと（view）だけだが、出力・取込みを作ったらここに並ぶ。
 */
const TAKE_OUT_ACTIONS = ["view", "export", "import"];

/** GET /api/admin/access-log — 持ち出しの記録。 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const { logs, total, page, pageSize, userOf } = await listAuditLogs(TAKE_OUT_ACTIONS, req.url);

  // 対象の製品名も、まとめて引いて組み立てる
  const productIds = [...new Set(logs.map((l) => l.entityId).filter((v) => v !== null))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, code: true, nameJa: true },
  });
  const productOf = new Map(products.map((p) => [p.id, p]));

  const items: AccessLogDto[] = logs.map((l) => {
    const u = l.actorId ? userOf.get(l.actorId) : undefined;
    const p = l.entityId ? productOf.get(l.entityId) : undefined;
    const d = (l.diff ?? {}) as { lineCount?: number; expanded?: boolean; ip?: string | null };
    return {
      id: l.id,
      at: l.at.toISOString(),
      action: l.action,
      actorId: l.actorId,
      // 消えた利用者でも記録は残る。分かる範囲を出す
      actorName: u?.displayName ?? u?.email ?? null,
      productId: l.entityId,
      productCode: p?.code ?? null,
      productName: p?.nameJa ?? null,
      lineCount: d.lineCount ?? null,
      expanded: d.expanded ?? null,
      ip: d.ip ?? null,
    };
  });

  return Response.json({ items, total, page, pageSize });
}
