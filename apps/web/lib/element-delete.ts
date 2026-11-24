import type { Messages } from "@chem/shared";
import type { Element } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = Element & { id: string; label: string; deleted: boolean };

/** 元素の削除（論理削除。id は元素記号。lib/stamped-delete.ts） */
export function elementDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.element.findMany({ where: { symbol: { in: ids } } });
      return rows.map((e) => ({
        ...e,
        id: e.symbol,
        label: e.symbol,
        deleted: e.deletedAt !== null,
      }));
    },
    missingMeansDeleted: false,
    async refuse(row) {
      const used = await prisma.metalConversionFactor.count({
        where: { metalElement: row.symbol, deletedAt: null },
      });
      return used > 0 ? m.elements.inUse(used) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.element.updateMany({
        where: { symbol: row.symbol, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id },
      });
      return r.count;
    },
    audit: {
      entity: "elements",
      actorId: actor.user.id,
      diff: (row) => ({ symbol: row.symbol, nameJa: row.nameJa }),
    },
  };
}
