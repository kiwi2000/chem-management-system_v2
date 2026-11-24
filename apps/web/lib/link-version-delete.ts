import type { Messages } from "@chem/shared";
import type { LinkSetVersion } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ensureCurrentVersion } from "@/lib/link-service";
import { retiredCode, type DeleteSpec } from "@/lib/stamped-delete";

type Row = LinkSetVersion & { label: string; deleted: boolean };

/** 法規制データのバージョンの削除（論理削除。lib/stamped-delete.ts） */
export function linkVersionDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.linkSetVersion.findMany({ where: { id: { in: ids } } });
      return rows.map((v) => ({ ...v, label: v.code, deleted: v.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async refuse(row) {
      return row.isCurrent ? m.linkVersions.cannotDeleteCurrent : null;
    },
    async remove(tx, row, guard) {
      // 確かめたあとで「現在」にされていたら消さない
      const r = await tx.linkSetVersion.updateMany({
        where: { id: row.id, deletedAt: null, isCurrent: false, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id, codeNormalized: retiredCode(row) },
      });
      return r.count;
    },
    async after() {
      await ensureCurrentVersion(actor.user.id);
    },
    audit: {
      entity: "link_set_versions",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code }),
    },
  };
}
