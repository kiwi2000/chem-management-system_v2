import type { Messages } from "@chem/shared";
import type { User } from "@prisma/client";
import { revokeAllSessions } from "@/lib/auth";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = User & { label: string; deleted: boolean };

/** ユーザーの削除（論理削除。無効にして、ログインも全部切る。lib/stamped-delete.ts） */
export function userDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.user.findMany({ where: { id: { in: ids } } });
      // 印は管理者が直す中身を変えた時刻（editedAt）。更新時刻はログインでも進むので使わない（2026-11-24）
      return rows.map((u) => ({
        ...u,
        updatedAt: u.editedAt,
        label: u.email,
        deleted: u.deletedAt !== null,
      }));
    },
    missingMeansDeleted: false,
    async refuse(row, batch) {
      if (row.id === actor.user.id) return m.errors.cannotDeleteSelf;
      // 消したあとに、有効なシステム管理者が 1 人も残らないなら断る（いっしょに消す人は数えない）
      const admins = await prisma.userPermissionGroup.count({
        where: {
          group: { isSystemAdmin: true },
          userId: { notIn: [...batch] },
          user: { activeFlag: true, deletedAt: null },
        },
      });
      return admins === 0 ? m.errors.cannotRemoveLastAdmin : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.user.updateMany({
        where: { id: row.id, deletedAt: null, editedAt: guard.updatedAt },
        data: { deletedAt: new Date(), activeFlag: false, editedAt: new Date() },
      });
      return r.count;
    },
    async after(rows) {
      for (const r of rows) await revokeAllSessions(r.id);
    },
    audit: { entity: "users", actorId: actor.user.id, diff: (row) => ({ email: row.email }) },
  };
}
