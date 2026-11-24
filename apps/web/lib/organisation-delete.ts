import type { Messages } from "@chem/shared";
import type { Organisation } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = Organisation & { label: string; deleted: boolean; _count: { members: number } };

/** 組織の削除（論理削除。lib/stamped-delete.ts） */
export function organisationDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.organisation.findMany({
        where: { id: { in: ids } },
        include: { _count: { select: { members: true } } },
      });
      return rows.map((o) => ({ ...o, label: o.code, deleted: o.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async refuse(row, batch) {
      if (row._count.members > 0) return m.organisations.inUse(row._count.members);
      // 下の組織がある組織は消せない（S31。先に下の組織を移すか消す）。いっしょに消す下の組織は数えない
      const children = await prisma.organisation.count({
        where: { parentId: row.id, deletedAt: null, id: { notIn: [...batch] } },
      });
      return children > 0 ? m.owner.usedElsewhere : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.organisation.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        /*
          コードを空ける（2026-11-24 利用者の指示。同じコードで作り直せるように）。
          組織は正規化コードの列を持たず、一意の決まりがコードそのものに掛かっているので、
          コードに「:内部の id」を付けて退避する。消したときの記録には元のコードが残る
        */
        data: { deletedAt: new Date(), code: `${row.code}:${row.id}` },
      });
      return r.count;
    },
    audit: {
      entity: "organisations",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code, nameJa: row.nameJa }),
    },
  };
}
