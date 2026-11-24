import type { Messages } from "@chem/shared";
import type { Feedback, FeedbackComment } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { DeleteSpec } from "@/lib/stamped-delete";

type FeedbackRow = Feedback & { label: string; deleted: boolean };

/** ご意見の削除（論理削除。lib/stamped-delete.ts） */
export function feedbackDelete(actor: Actor): DeleteSpec<FeedbackRow> {
  return {
    async load(ids) {
      const rows = await prisma.feedback.findMany({ where: { id: { in: ids } } });
      return rows.map((f) => ({ ...f, label: f.title, deleted: f.deletedAt !== null }));
    },
    missingMeansDeleted: false,
    async remove(tx, row, guard) {
      const r = await tx.feedback.updateMany({
        where: { id: row.id, deletedAt: null, ...guard },
        data: { deletedAt: new Date(), updatedBy: actor.user.id },
      });
      return r.count;
    },
    audit: { entity: "feedbacks", actorId: actor.user.id, diff: (row) => ({ title: row.title }) },
  };
}

type CommentRow = FeedbackComment & { label: string; deleted: boolean; updatedAt: Date };

/**
 * ご意見への返信の削除（論理削除）。書いた本人か管理者だけ。
 * 返信は直せないので、印は書いた時刻（`createdAt`）。食い違いは起きず、「すでに削除」だけを見分ける
 */
export function feedbackCommentDelete(
  actor: Actor,
  m: Messages,
  feedbackId: string,
): DeleteSpec<CommentRow> {
  return {
    async load(ids) {
      const rows = await prisma.feedbackComment.findMany({
        where: { id: { in: ids }, feedbackId },
      });
      return rows.map((c) => ({
        ...c,
        updatedAt: c.createdAt,
        label: c.body.length > 20 ? `${c.body.slice(0, 20)}…` : c.body,
        deleted: c.deletedAt !== null,
      }));
    },
    missingMeansDeleted: false,
    async refuse(row) {
      return row.createdBy === actor.user.id || actor.has("ADMIN") ? null : m.errors.forbidden;
    },
    async remove(tx, row, guard) {
      const r = await tx.feedbackComment.updateMany({
        where: { id: row.id, deletedAt: null, createdAt: guard.updatedAt },
        data: { deletedAt: new Date() },
      });
      return r.count;
    },
    audit: {
      entity: "feedback_comments",
      actorId: actor.user.id,
      diff: () => ({ feedbackId }),
    },
  };
}
