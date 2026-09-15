import { z } from "zod";

/**
 * まとめて帳票を作る依頼（バックグラウンド処理。2026-09-16）。
 *
 * 作る相手は **ID の並び** か、**一覧の絞り込みの条件** のどちらか。
 * 絞り込みの条件で頼むと、走るときに一覧と同じ条件で引き直す（「絞り込みに当たる全件」）。
 * 条件は一覧の URL に載るのと同じ書きかた（`f.<列>=...`）の文字列で持つ。
 */
export const docSelectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ids"),
    ids: z.array(z.string().trim().min(1)).min(1).max(10000),
  }),
  z.object({
    mode: z.literal("all"),
    /** 一覧の絞り込み（問い合わせ文字列）。空なら見えるもの全部 */
    filter: z.string().max(10000),
  }),
]);
export type DocSelection = z.infer<typeof docSelectionSchema>;

export const docBatchRequestSchema = z.object({
  templateId: z.string().trim().min(1),
  selection: docSelectionSchema,
  /** 任意の会社・任意の部署・宛先（組織のID）。1件ずつ作るときの URL と同じもの */
  company: z.string().trim().nullable().optional(),
  department: z.string().trim().nullable().optional(),
  to: z.string().trim().nullable().optional(),
  /** 組織ブロックで選んだ組織。`<ブロックid>:<組織id>` の並び */
  org: z.array(z.string()).max(100).optional(),
});
export type DocBatchRequest = z.infer<typeof docBatchRequestSchema>;

export const DOC_BATCH_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED"] as const;
export type DocBatchStatusValue = (typeof DOC_BATCH_STATUSES)[number];
