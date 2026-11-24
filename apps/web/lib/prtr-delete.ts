import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

/**
 * PRTR の届出の行（取扱量・実測値）の削除（物理削除。lib/stamped-delete.ts）。
 * 届出を見られる組織か・確定中でないかは、呼ぶ側（API）が先に確かめる。届出の中の行に、それ以上の見える範囲は無い
 */

interface QuantityRow {
  id: string;
  label: string;
  method: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/** 製品ごとの取扱量の行 */
export function prtrQuantityDelete(actor: Actor, entryId: string): DeleteSpec<QuantityRow> {
  return {
    async load(ids) {
      const rows = await prisma.prtrQuantity.findMany({
        where: { id: { in: ids }, entryId },
        select: {
          id: true,
          method: true,
          updatedAt: true,
          updatedBy: true,
          product: { select: { code: true } },
        },
      });
      return rows.map(({ product, ...r }) => ({ ...r, label: product.code }));
    },
    missingMeansDeleted: true,
    async remove(tx, row, guard) {
      const r = await tx.prtrQuantity.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: {
      entity: "prtr_quantities",
      actorId: actor.user.id,
      diff: (row) => ({ product: row.label, method: row.method }),
    },
  };
}

interface MeasuredRow {
  id: string;
  label: string;
  statutorySubstanceId: string;
  updatedAt: Date;
  updatedBy: string | null;
}

/** 実測値の行 */
export function prtrMeasuredDelete(actor: Actor, entryId: string): DeleteSpec<MeasuredRow> {
  return {
    async load(ids) {
      const rows = await prisma.prtrMeasured.findMany({
        where: { id: { in: ids }, entryId },
        select: {
          id: true,
          statutorySubstanceId: true,
          updatedAt: true,
          updatedBy: true,
          statutorySubstance: { select: { nameJa: true, nameOriginal: true } },
          substance: { select: { code: true } },
        },
      });
      return rows.map(({ statutorySubstance, substance, ...r }) => ({
        ...r,
        // 画面の行と同じく、物質コードがあればそれ、無ければ法文物質名
        label: substance?.code ?? statutorySubstance.nameJa ?? statutorySubstance.nameOriginal,
      }));
    },
    missingMeansDeleted: true,
    async remove(tx, row, guard) {
      const r = await tx.prtrMeasured.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: {
      entity: "prtr_measured",
      actorId: actor.user.id,
      diff: (row) => ({ statutorySubstanceId: row.statutorySubstanceId }),
    },
  };
}
