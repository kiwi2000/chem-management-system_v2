import type { Messages } from "@chem/shared";
import type { LinkVersionSource } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = LinkVersionSource & { label: string; versionCode: string; sourceCode: string };

/** バージョンに並べたデータソースの削除（行ごと消す。lib/stamped-delete.ts） */
export function linkVersionSourceDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.linkVersionSource.findMany({
        where: { id: { in: ids } },
        include: { version: { select: { code: true } }, source: { select: { code: true } } },
      });
      return rows.map(({ version, source, ...r }) => ({
        ...r,
        label: source.code,
        versionCode: version.code,
        sourceCode: source.code,
      }));
    },
    // 行ごと消える表で、見える範囲の制限も無い。読めない行は、もう消えたもの
    missingMeansDeleted: true,
    async refuse(row) {
      const links = await prisma.statutoryCasLink.count({
        where: { versionId: row.versionId, sourceId: row.sourceId },
      });
      return links > 0 ? m.dataSources.inUseByLinks(links) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.linkVersionSource.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: {
      entity: "link_version_sources",
      actorId: actor.user.id,
      diff: (row) => ({ version: row.versionCode, source: row.sourceCode }),
    },
  };
}
