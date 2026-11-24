import type { Messages } from "@chem/shared";
import type { Source } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { retiredCode, type DeleteSpec } from "@/lib/stamped-delete";

type Row = Source & { label: string; deleted: boolean };

/** データソースの削除（論理削除。lib/stamped-delete.ts） */
export function sourceDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.source.findMany({ where: { id: { in: ids } } });
      return rows.map((s) => ({ ...s, label: s.code, deleted: s.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async refuse(row) {
      const [versions, links] = await Promise.all([
        prisma.linkVersionSource.count({ where: { sourceId: row.id } }),
        prisma.statutoryCasLink.count({ where: { sourceId: row.id } }),
      ]);
      if (versions > 0) return m.sources.inUseByVersions(versions);
      if (links > 0) return m.sources.inUseByLinks(links);
      return null;
    },
    async remove(tx, row, guard) {
      const r = await tx.source.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id, codeNormalized: retiredCode(row) },
      });
      return r.count;
    },
    audit: { entity: "sources", actorId: actor.user.id, diff: (row) => ({ code: row.code }) },
  };
}
