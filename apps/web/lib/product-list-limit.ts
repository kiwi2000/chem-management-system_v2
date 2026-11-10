import type { TableState } from "@chem/shared";
import type { Actor } from "@/lib/authz";
import { filterCompositionVisible } from "@/lib/composition-access";
import { prisma } from "@/lib/db";
import { productColumns } from "@/lib/list-columns";
import { visibilityWhere } from "@/lib/product-service";

/**
 * 製品の一覧で、組成をたどる絞り込み（含まれる CAS・物質名など）を使っているときの追加の条件（S31）。
 * 組成を見られる製品（仕様 10 章の 3 つの条件）だけに限る。見られない製品が当たると、組成の手がかりになるため。
 * 組成の絞り込みを使っていないとき・システム管理グループの人は、何も足さない
 */
export async function compositionFilterLimit(
  actor: Actor,
  versionId: string | null,
  columns: { key: string }[],
  filters: TableState["filters"],
): Promise<{ id?: { in: string[] } }> {
  if (actor.isSystemAdmin) return {};
  const plainKeys = new Set(productColumns(versionId, false).map((c) => c.key));
  const compositionKeys = new Set(columns.map((c) => c.key).filter((k) => !plainKeys.has(k)));
  if (!Object.keys(filters).some((k) => compositionKeys.has(k))) return {};
  const all = await prisma.product.findMany({
    where: { deletedAt: null, ...visibilityWhere(actor) },
    select: { id: true },
  });
  const visible = await filterCompositionVisible(
    actor,
    all.map((p) => p.id),
  );
  return { id: { in: [...visible] } };
}
