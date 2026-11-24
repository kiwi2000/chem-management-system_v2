import type { Messages } from "@chem/shared";
import type { News } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { canEditNews, canSeeNews, newsOrgChain } from "@/lib/news-service";
import type { DeleteSpec } from "@/lib/stamped-delete";

type Row = News & { label: string; hidden: boolean };

/**
 * お知らせの削除（行ごと消す。lib/stamped-delete.ts）。
 *
 * 見えないお知らせも読んだうえで「見つかりません」で断る（題名も出さない）。
 * だから読めないものは本当に消えたもので、「すでに削除されています」と言ってよい
 */
export function newsDelete(actor: Actor, m: Messages): DeleteSpec<Row> {
  return {
    async load(ids) {
      const rows = await prisma.news.findMany({ where: { id: { in: ids } } });
      const chainIds = (await newsOrgChain(actor)).map((o) => o.id);
      return rows.map((n) => {
        // 見えないものは「見つかりません」（題名も、誰がいつ変えたかも出さない。lib/stamped-delete.ts）
        return { ...n, hidden: !canSeeNews(actor, chainIds, n), label: n.titleJa };
      });
    },
    missingMeansDeleted: true,
    async refuse(row) {
      if (canEditNews(actor, row.authorId)) return null;
      return actor.has("NEWS_POST") ? m.errors.forbiddenNewsOther : m.errors.forbidden;
    },
    async remove(tx, row, guard) {
      const r = await tx.news.deleteMany({ where: { id: row.id, ...guard } });
      return r.count;
    },
    audit: { entity: "news", actorId: actor.user.id, diff: (row) => ({ titleJa: row.titleJa }) },
  };
}
