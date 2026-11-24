import type { MetalConversionFactor } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = MetalConversionFactor & { label: string; deleted: boolean };

/** 金属換算係数の削除（論理削除。lib/stamped-delete.ts） */
export function metalFactorDelete(actor: Actor): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.metalConversionFactor.findMany({ where: { id: { in: ids } } });
      return rows.map((f) => ({
        ...f,
        label: `${f.casNumber} / ${f.metalElement}`,
        deleted: f.deletedAt !== null,
      }));
    },
    missingMeansDeleted: false,
    async remove(tx, row, guard) {
      const r = await tx.metalConversionFactor.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id },
      });
      return r.count;
    },
    audit: {
      entity: "metal_conversion_factors",
      actorId: actor.user.id,
      diff: (row) => ({ casNumber: row.casNumber, metalElement: row.metalElement }),
    },
  };
}
