import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

interface Row {
  id: string;
  label: string;
  code: string;
  updatedAt: Date;
  updatedBy: string | null;
  deleted: boolean;
}

/** ドキュメントのひな形の削除（論理削除。lib/stamped-delete.ts） */
export function docTemplateDelete(actor: Actor): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.documentTemplate.findMany({
        where: { id: { in: ids } },
        select: { id: true, code: true, updatedAt: true, updatedBy: true, deletedAt: true },
      });
      return rows.map(({ deletedAt, ...r }) => ({
        ...r,
        label: r.code,
        deleted: deletedAt !== null,
      }));
    },
    missingMeansDeleted: false,
    async remove(tx, row, guard) {
      const r = await tx.documentTemplate.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id },
      });
      return r.count;
    },
    audit: {
      entity: "document_templates",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code }),
    },
  };
}
