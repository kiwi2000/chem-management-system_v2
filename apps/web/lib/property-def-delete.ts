import type { Messages } from "@chem/shared";
import type { PropertyDef } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = PropertyDef & { label: string };

/** 拡張属性の項目の削除（行ごと消す。lib/stamped-delete.ts） */
export function propertyDefDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.propertyDef.findMany({ where: { id: { in: ids } } });
      return rows.map((d) => ({ ...d, label: d.labelJa }));
    },
    // 管理者だけが触り、見える範囲の制限は無い。読めないものは、消されたもの
    missingMeansDeleted: true,
    async refuse(row) {
      // システムが読む項目は消させない（「使わない」にはできる）
      return row.systemFlag ? m.propertyDefs.systemCannotDelete(row.labelJa) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.propertyDef.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: {
      entity: "property_defs",
      actorId: actor.user.id,
      diff: (row) => ({ target: row.target, key: row.key }),
    },
  };
}
