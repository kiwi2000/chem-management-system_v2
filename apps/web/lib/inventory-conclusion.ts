import { inventoryFoot, type InventoryFoot } from "@/lib/aggregate-footer";
import { prisma } from "@/lib/db";
import { listInventoryColumns, listNumbersByCas } from "@/lib/substance-numbers";

/**
 * 組成を見る権限の無い人に見せる、インベントリごとの結論（2026-10-14 指示）。
 *
 * 最終組成の表のいちばん下と同じ決め方（`inventoryFoot`）で、「全て該当」か「要確認」かだけを返す。
 * **物質ごとの番号は返さない。**化審法番号や EC 番号は物質を特定できるので、組成を見られない人には出せない。
 *
 * 組成は、判定に使った展開（`ProductExpansion`）をもとにする。判定結果と同じ時点の中身で、
 * 見ている人の権限で原材料が開けないことにも左右されない（返すのは結論だけ）。
 * インベントリは、最終組成の表で最初から出ているもの（「番号として出す」と決めたもの）だけ
 */
export async function inventoryConclusions(
  productId: string,
): Promise<{ id: string; label: string; result: InventoryFoot }[]> {
  const expansion = await prisma.productExpansion.findUnique({
    where: { productId },
    select: {
      unknownPct: true,
      truncated: true,
      lines: { select: { casNormalized: true } },
    },
  });
  if (!expansion) return [];

  const inventories = (await listInventoryColumns()).filter((i) => i.shown);
  if (inventories.length === 0) return [];

  const numbers = await listNumbersByCas(
    expansion.lines.map((l) => l.casNormalized ?? "").filter(Boolean),
    { all: true },
  );
  const rows = expansion.lines.map((l) => ({
    numbers: (l.casNormalized ? numbers.get(l.casNormalized) : undefined) ?? [],
  }));
  // 中身の分からない分（開けなかった原材料・打ち切った枝）があれば、番号を引けないので要確認
  const incomplete = !expansion.unknownPct.isZero() || expansion.truncated > 0;

  return inventories.map((i) => ({
    id: i.id,
    label: i.label,
    result: inventoryFoot(rows, i.id, incomplete),
  }));
}
