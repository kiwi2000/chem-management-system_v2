import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

interface Row {
  id: string;
  label: string;
  title: string;
  fileName: string;
  size: number;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * 製品の添付ファイルの削除（物理削除。lib/stamped-delete.ts）。
 * 製品が見えるか・添付を直せるかは、呼ぶ側（API）が先に確かめる。製品の中の添付に、それ以上の見える範囲は無い
 */
export function attachmentDelete(
  actor: Actor,
  product: { id: string; code: string },
): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.productAttachment.findMany({
        where: { id: { in: ids }, productId: product.id },
        select: {
          id: true,
          title: true,
          fileName: true,
          size: true,
          updatedAt: true,
          updatedBy: true,
        },
      });
      return rows.map((r) => ({ ...r, label: r.title || r.fileName }));
    },
    missingMeansDeleted: true,
    async remove(tx, row, guard) {
      const r = await tx.productAttachment.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: {
      entity: "product_attachment",
      actorId: actor.user.id,
      diff: (row) => ({
        productId: product.id,
        productCode: product.code,
        title: row.title,
        fileName: row.fileName,
        size: row.size,
      }),
    },
  };
}
