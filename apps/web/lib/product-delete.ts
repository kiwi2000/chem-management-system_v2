import type { Messages } from "@chem/shared";
import type { Product } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { productsUsing, referencedMessage } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { canEditProduct, visibilityWhere } from "@/lib/product-service";
import { retiredCode, type DeleteSpec } from "@/lib/stamped-delete";

type Row = Product & { label: string; deleted: boolean };

/** 製品・原材料の削除（論理削除。lib/stamped-delete.ts） */
export function productDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.product.findMany({
        where: { id: { in: ids }, ...visibilityWhere(actor) },
      });
      return rows.map((p) => ({ ...p, label: p.code, deleted: p.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async refuse(row, batch) {
      if (!canEditProduct(actor, row)) return m.errors.forbidden;
      // 見えない製品で使われていれば、件数を言わない（S31 仕様 7 章）。いっしょに消す親は数えない
      const users = (await productsUsing({ childProductId: row.id })).filter((u) => !batch.has(u));
      return users.length > 0 ? referencedMessage(actor, users, m) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.product.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id, codeNormalized: retiredCode(row) },
      });
      return r.count;
    },
    audit: { entity: "products", actorId: actor.user.id, diff: (row) => ({ code: row.code }) },
  };
}
