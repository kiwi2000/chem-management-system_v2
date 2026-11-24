import type { StatutoryCasLink } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = StatutoryCasLink & { label: string; sourceCode: string };

/** 法文物質と CAS のリンクの削除（行ごと消す。lib/stamped-delete.ts） */
export function statutoryCasLinkDelete(actor: Actor): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.statutoryCasLink.findMany({
        where: { id: { in: ids } },
        include: { source: { select: { code: true } } },
      });
      return rows.map(({ source, ...l }) => ({
        ...l,
        label: l.casNumber,
        sourceCode: source.code,
      }));
    },
    // 行ごと消える表で、見える範囲の制限も無い。読めない行は、もう消えたもの
    missingMeansDeleted: true,
    async remove(tx, row, guard) {
      const r = await tx.statutoryCasLink.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: {
      entity: "statutory_cas_links",
      actorId: actor.user.id,
      diff: (row) => ({ casNumber: row.casNumber, sourceCode: row.sourceCode }),
    },
  };
}
