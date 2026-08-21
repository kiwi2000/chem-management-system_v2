import type { PendingResolution } from "@chem/shared";
import { prisma } from "@/lib/db";
import { writeApprovalEvent } from "@/lib/publish-service";

/** 承認待の件数。設定を切り替える前に、宙に浮くものがあるか確かめる */
export async function countPending(): Promise<{ substance: number; product: number }> {
  const [substance, product] = await Promise.all([
    prisma.substance.count({ where: { deletedAt: null, publishState: "PENDING" } }),
    prisma.product.count({ where: { deletedAt: null, publishState: "PENDING" } }),
  ]);
  return { substance, product };
}

/**
 * 承認が不要になったあとの後始末。
 * 作成中に戻す（申請を取り下げた扱い）か、そのまま公開する（承認した扱い）かを選ぶ。
 * どちらにしても履歴には残す。誰の操作で状態が変わったのか追えるようにするため。
 */
export async function resolvePending(
  entity: "substance" | "product",
  how: PendingResolution,
  actorId: string,
): Promise<number> {
  const next = how === "publish" ? "PUBLISHED" : "DRAFT";
  const targets =
    entity === "substance"
      ? await prisma.substance.findMany({
          where: { deletedAt: null, publishState: "PENDING" },
          select: { id: true },
        })
      : await prisma.product.findMany({
          where: { deletedAt: null, publishState: "PENDING" },
          select: { id: true },
        });
  if (targets.length === 0) return 0;

  const ids = targets.map((t) => t.id);
  if (entity === "substance") {
    await prisma.substance.updateMany({ where: { id: { in: ids } }, data: { publishState: next } });
  } else {
    await prisma.product.updateMany({ where: { id: { in: ids } }, data: { publishState: next } });
  }

  for (const id of ids) {
    await writeApprovalEvent({
      entity,
      entityId: id,
      action: how === "publish" ? "approve" : "withdraw",
      actorId,
      comment: "承認を不要に切り替えたため",
    });
  }
  return ids.length;
}
