import type { Messages } from "@chem/shared";
import type { Law, RegulationCategory, RegulationClass, StatutorySubstance } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ensureDefaultClass } from "@/lib/law-service";
import { retiredCode, type DeleteSpec } from "@/lib/stamped-delete";

/*
  法令の木（法律・規制区分・分類・法文物質）の削除（論理削除。lib/stamped-delete.ts）。
  法律・区分・分類・法文物質は見える範囲の制限が無く、論理削除なので、読めない行は「見つかりません」にする
*/

type ClassRow = RegulationClass & { label: string; deleted: boolean };
type SubstanceRow = StatutorySubstance & { label: string; deleted: boolean };

/** 分類。配下の法文物質も一緒に消す。区分の分類が 0 になったら既定の分類を作り直す */
export function regulationClassDelete(actor: Actor): DeleteSpec<ClassRow> {
  return {
    async load(ids) {
      const rows = await prisma.regulationClass.findMany({ where: { id: { in: ids } } });
      return rows.map((r) => ({ ...r, label: r.code, deleted: r.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async remove(tx, row, guard) {
      const now = new Date();
      const r = await tx.regulationClass.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: now, updatedBy: actor.user.id, codeNormalized: retiredCode(row) },
      });
      if (r.count === 0) return 0;
      await tx.statutorySubstance.updateMany({
        where: { classId: row.id, deletedAt: null },
        data: { deletedAt: now, updatedBy: actor.user.id },
      });
      return r.count;
    },
    async after(rows) {
      for (const categoryId of new Set(rows.map((r) => r.categoryId))) {
        await ensureDefaultClass(categoryId, actor.user.id);
      }
    },
    audit: {
      entity: "regulation_classes",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code, nameOriginal: row.nameOriginal }),
    },
  };
}

/** 法文物質 */
export function statutorySubstanceDelete(actor: Actor): DeleteSpec<SubstanceRow> {
  return {
    async load(ids) {
      const rows = await prisma.statutorySubstance.findMany({ where: { id: { in: ids } } });
      return rows.map((r) => ({ ...r, label: r.code, deleted: r.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async remove(tx, row, guard) {
      const r = await tx.statutorySubstance.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id, codeNormalized: retiredCode(row) },
      });
      return r.count;
    },
    audit: {
      entity: "statutory_substances",
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code, nameOriginal: row.nameOriginal }),
    },
  };
}

/** 法令の木の 1 行。id は「種類:元の id」（law:… / category:… / class:…） */
type TreeRow = {
  id: string;
  kind: "law" | "category" | "class";
  rawId: string;
  label: string;
  updatedAt: Date;
  updatedBy: string | null;
  deleted: boolean;
  code: string;
  codeNormalized: string;
  nameOriginal: string | null;
  /** 分類のときの区分 */
  categoryId: string | null;
};

const KIND_ORDER = { class: 0, category: 1, law: 2 } as const;
const ENTITY = { law: "laws", category: "regulation_categories", class: "regulation_classes" };

/**
 * 法令の木（法律・区分・分類を 1 つの表で混ぜて選べる）をまとめて消す。
 * **種類をまたいでも、全部か、何もしないか。**種類ごとに分けて送ると、区分を消したあとで法律が断られたとき、
 * 区分だけ消えた状態が残る。
 *
 * - 子から先に消す（分類 → 区分 → 法律）。区分を消すと中の分類も消えるので、先に区分を消すと
 *   同じ回で選んだ分類が「確かめたあとで変わった」になってしまう
 * - いっしょに消す子は数えない（法律と、その下の区分を全部選べば、法律も消せる）
 */
export function lawTreeDelete(actor: Actor, m: Messages): DeleteSpec<TreeRow> {
  return {
    async load(ids) {
      const pick = (kind: string) =>
        ids.filter((id) => id.startsWith(`${kind}:`)).map((id) => id.slice(kind.length + 1));
      const [laws, categories, classes] = await Promise.all([
        prisma.law.findMany({ where: { id: { in: pick("law") } } }),
        prisma.regulationCategory.findMany({ where: { id: { in: pick("category") } } }),
        prisma.regulationClass.findMany({ where: { id: { in: pick("class") } } }),
      ]);
      const row = (
        kind: TreeRow["kind"],
        r: Law | RegulationCategory | RegulationClass,
        categoryId: string | null,
      ): TreeRow => ({
        id: `${kind}:${r.id}`,
        kind,
        rawId: r.id,
        label: r.code,
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
        deleted: r.deletedAt !== null,
        code: r.code,
        codeNormalized: r.codeNormalized,
        nameOriginal: r.nameOriginal,
        categoryId,
      });
      return [
        ...classes.map((r) => row("class", r, r.categoryId)),
        ...categories.map((r) => row("category", r, null)),
        ...laws.map((r) => row("law", r, null)),
      ].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    },
    missingMeansDeleted: false,
    async refuse(row, batch) {
      const inBatch = (kind: string) =>
        [...batch].filter((id) => id.startsWith(`${kind}:`)).map((id) => id.slice(kind.length + 1));
      if (row.kind === "law") {
        // いっしょに消す区分は数えない
        const categories = await prisma.regulationCategory.count({
          where: { lawId: row.rawId, deletedAt: null, id: { notIn: inBatch("category") } },
        });
        return categories > 0 ? m.laws.inUse(categories) : null;
      }
      if (row.kind === "category") {
        // いっしょに消す分類の中の法文物質は、分類と一緒に消えるので数えない
        const substances = await prisma.statutorySubstance.count({
          where: {
            deletedAt: null,
            regulationClass: {
              categoryId: row.rawId,
              deletedAt: null,
              id: { notIn: inBatch("class") },
            },
          },
        });
        return substances > 0 ? m.regulationCategories.inUse(substances) : null;
      }
      return null;
    },
    async remove(tx, row, guard) {
      const now = new Date();
      const data = { deletedAt: now, updatedBy: actor.user.id, codeNormalized: retiredCode(row) };
      const where = { id: row.rawId, deletedAt: null, ...guard };
      if (row.kind === "law") return (await tx.law.updateMany({ where, data })).count;
      if (row.kind === "category") {
        const r = await tx.regulationCategory.updateMany({ where, data });
        if (r.count === 0) return 0;
        // 中身のない分類は、区分と一緒に片付ける（残しても使い道がない）
        await tx.regulationClass.updateMany({
          where: { categoryId: row.rawId, deletedAt: null },
          data: { deletedAt: now, updatedBy: actor.user.id },
        });
        return r.count;
      }
      const r = await tx.regulationClass.updateMany({ where, data });
      if (r.count === 0) return 0;
      await tx.statutorySubstance.updateMany({
        where: { classId: row.rawId, deletedAt: null },
        data: { deletedAt: now, updatedBy: actor.user.id },
      });
      return r.count;
    },
    async after(rows) {
      // 分類が 0 になった区分には既定の分類を作り直す。いっしょに消した区分は除く
      const goneCategories = new Set(rows.filter((r) => r.kind === "category").map((r) => r.rawId));
      const touched = new Set(
        rows.flatMap((r) => (r.kind === "class" && r.categoryId ? [r.categoryId] : [])),
      );
      for (const categoryId of touched) {
        if (!goneCategories.has(categoryId)) await ensureDefaultClass(categoryId, actor.user.id);
      }
    },
    audit: {
      entity: (row) => ENTITY[row.kind],
      entityId: (row) => row.rawId,
      actorId: actor.user.id,
      diff: (row) => ({ code: row.code, nameOriginal: row.nameOriginal }),
    },
  };
}
