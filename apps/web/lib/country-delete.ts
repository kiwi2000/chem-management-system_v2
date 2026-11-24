import type { Country } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { retiredCode, type DeleteSpec } from "@/lib/stamped-delete";

type Row = Country & { label: string; deleted: boolean };

/** 国の削除（論理削除。lib/stamped-delete.ts） */
export function countryDelete(actor: Actor): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.country.findMany({ where: { id: { in: ids } } });
      return rows.map((c) => ({ ...c, label: c.code, deleted: c.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async remove(tx, row, guard) {
      const r = await tx.country.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        // 一意制約を空けるための退避。原文の code はそのまま残す
        data: { deletedAt: new Date(), updatedBy: actor.user.id, codeNormalized: retiredCode(row) },
      });
      return r.count;
    },
    audit: {
      entity: "countries",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code, nameJa: row.nameJa }),
    },
  };
}
