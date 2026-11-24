import type { Messages } from "@chem/shared";
import type { Region } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { retiredCode, type DeleteSpec } from "@/lib/stamped-delete";

type Row = Region & { label: string; deleted: boolean };

/** 地域の削除（論理削除。lib/stamped-delete.ts） */
export function regionDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.region.findMany({ where: { id: { in: ids } } });
      return rows.map((r) => ({ ...r, label: r.code, deleted: r.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async refuse(row) {
      // 法律は国にぶら下がるので、地域を守るには国の数だけ見ればよい
      const countries = await prisma.country.count({
        where: { regionId: row.id, deletedAt: null },
      });
      return countries > 0 ? m.regions.inUseByCountries(countries) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.region.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        // 一意制約を空けるための退避。原文の code はそのまま残す
        data: { deletedAt: new Date(), updatedBy: actor.user.id, codeNormalized: retiredCode(row) },
      });
      return r.count;
    },
    audit: {
      entity: "regions",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code, nameJa: row.nameJa }),
    },
  };
}
