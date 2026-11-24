import type { Messages } from "@chem/shared";
import type { Language } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { countLanguageUses } from "@/lib/language-service";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = Language & { label: string; deleted: boolean };

/** 言語の削除（論理削除。lib/stamped-delete.ts） */
export function languageDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.language.findMany({ where: { id: { in: ids } } });
      return rows.map((l) => ({ ...l, label: l.code, deleted: l.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async refuse(row) {
      const uses = await countLanguageUses(row.code);
      return uses > 0 ? m.languages.inUse(uses) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.language.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id },
      });
      return r.count;
    },
    audit: {
      entity: "languages",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code, nameJa: row.nameJa }),
    },
  };
}
