import type { Messages } from "@chem/shared";
import type { PermissionGroup } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = PermissionGroup & {
  label: string;
  _count: { members: number; products: number; substances: number };
};

/** 管理グループの削除（行ごと消す。lib/stamped-delete.ts） */
export function permissionGroupDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.permissionGroup.findMany({
        where: { id: { in: ids } },
        include: { _count: { select: { members: true, products: true, substances: true } } },
      });
      return rows.map((g) => ({ ...g, label: g.code }));
    },
    // 管理者だけが触り、見える範囲の制限は無い。読めないものは、消されたもの
    missingMeansDeleted: true,
    async refuse(row) {
      if (row.isSystemAdmin) return m.permGroups.systemAdminLocked;
      const c = row._count;
      if (c.members > 0 || c.products > 0 || c.substances > 0) return m.permGroups.inUse(row.code);
      return null;
    },
    async remove(tx, row, guard) {
      const r = await tx.permissionGroup.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: {
      entity: "permission_groups",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code }),
    },
  };
}
