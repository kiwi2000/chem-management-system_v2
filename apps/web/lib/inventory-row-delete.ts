import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

interface Row {
  id: string;
  label: string;
  sourceId: string;
  casNumber: string;
  value: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/**
 * インベントリの行の削除（物理削除。lib/stamped-delete.ts）。
 * 消せるのは**画面で選んでいるバージョン**の、そのインベントリの行だけ
 * （URL を書き換えて他のバージョンの行を触られないようにするため。ほかのものは読めない＝消えたものとして扱う）
 */
export function inventoryRowDelete(
  actor: Actor,
  inventoryId: string,
  versionId: string,
): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.inventoryRow.findMany({
        where: { id: { in: ids }, inventoryId, versionId },
        select: {
          id: true,
          sourceId: true,
          casNumber: true,
          value: true,
          updatedAt: true,
          updatedBy: true,
        },
      });
      return rows.map((r) => ({ ...r, label: r.casNumber }));
    },
    missingMeansDeleted: true,
    async remove(tx, row, guard) {
      const r = await tx.inventoryRow.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: {
      entity: "inventory_rows",
      actorId: actor.user.id,
      diff: (row) => ({
        inventoryId,
        sourceId: row.sourceId,
        casNumber: row.casNumber,
        value: row.value,
      }),
    },
  };
}
