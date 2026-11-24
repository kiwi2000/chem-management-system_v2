import type { Messages } from "@chem/shared";
import type { Substance } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { productsUsing, referencedMessage } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { retiredCode, type DeleteSpec } from "@/lib/stamped-delete";
import {
  canEditSubstance,
  ensureCasRepresentative,
  visibilityWhere,
} from "@/lib/substance-service";

type Row = Substance & { label: string; deleted: boolean };

/** 物質の削除（論理削除。lib/stamped-delete.ts） */
export function substanceDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.substance.findMany({
        where: { id: { in: ids }, ...visibilityWhere(actor) },
      });
      return rows.map((s) => ({ ...s, label: s.code, deleted: s.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async refuse(row) {
      // 未公開のものは、作成者か専用の権限を持つ人だけが書き換えられる
      if (!canEditSubstance(actor, row)) return m.errors.forbidden;
      // 見えない製品で使われていれば、件数を言わない（S31 仕様 7 章）。製品はいっしょに消えないので全部数える
      const users = await productsUsing({ substanceId: row.id });
      return users.length > 0 ? referencedMessage(actor, users, m) : null;
    },
    async remove(tx, row, guard) {
      const r = await tx.substance.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: {
          deletedAt: new Date(),
          updatedBy: actor.user.id,
          isCasRepresentative: false,
          codeNormalized: retiredCode(row),
        },
      });
      return r.count;
    },
    async after(rows) {
      // 消したのが代表だった場合、そのCASの代表が空く。残っているものから埋め直す。
      // **書き込みの中では埋めない。**埋めると同じ回で消す別の行の更新時刻が進み、食い違いに見えてしまう
      const seen = new Set<string>();
      for (const r of rows) {
        const key = `${r.casNormalized ?? ""}\u0000${r.impurityTypeId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await ensureCasRepresentative(prisma, r.casNormalized, r.impurityTypeId);
      }
    },
    audit: { entity: "substances", actorId: actor.user.id, diff: (row) => ({ code: row.code }) },
  };
}
