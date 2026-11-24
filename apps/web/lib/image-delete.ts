import type { Messages } from "@chem/shared";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { usageOf } from "@/lib/image-service";
import type { DeleteSpec } from "@/lib/stamped-delete";

interface Row {
  id: string;
  label: string;
  name: string;
  updatedAt: Date;
}

/**
 * 画像の削除（物理削除。lib/stamped-delete.ts）。絵は DB の中にあるので、ほかに片付けるファイルは無い。
 * 帳票のひな形などで使われているものは消さない（消すと帳票から絵が抜ける）
 */
export function imageDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.imageAsset.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, updatedAt: true },
      });
      return rows.map((r) => ({ ...r, label: r.name }));
    },
    missingMeansDeleted: true,
    async refuse(row) {
      const used = ((await usageOf([row.id])).get(row.id) ?? []).length;
      return used > 0 ? m.images.inUse(used) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.imageAsset.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: { entity: "image_assets", actorId: actor.user.id, diff: (row) => ({ name: row.name }) },
  };
}
