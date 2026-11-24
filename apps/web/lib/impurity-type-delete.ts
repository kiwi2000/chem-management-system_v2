import { IMPURITY_NONE, type Messages } from "@chem/shared";
import type { ImpurityType } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = ImpurityType & { label: string; deleted: boolean };

/** 不純物の種類の削除（論理削除。lib/stamped-delete.ts） */
export function impurityTypeDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.impurityType.findMany({ where: { id: { in: ids } } });
      return rows.map((t) => ({ ...t, label: t.code, deleted: t.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async refuse(row) {
      if (row.builtin || row.id === IMPURITY_NONE) return m.impurityTypes.builtinDelete;
      const used = await prisma.substance.count({
        where: { impurityTypeId: row.id, deletedAt: null },
      });
      return used > 0 ? m.impurityTypes.inUse(used) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.impurityType.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id },
      });
      return r.count;
    },
    audit: {
      entity: "impurity_types",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code }),
    },
  };
}
