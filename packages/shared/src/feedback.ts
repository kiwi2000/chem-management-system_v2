import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * フィードバック。使ってみて気づいたことを記録する、簡単な課題管理。
 *
 * 開発中の窓口として作ったもので、本番を作るときに画面ごと外す。
 * そのため文言はここで日本語のまま持ち、多言語にはしない。
 * 閲覧も更新もログインしている人なら誰でもできる（権限は増やしていない）。
 */

export const FEEDBACK_KINDS = ["BUG", "REQUEST", "QUESTION", "OTHER"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];

export const FEEDBACK_STATUSES = ["OPEN", "IN_PROGRESS", "ON_HOLD", "DONE"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  BUG: "不具合",
  REQUEST: "要望",
  QUESTION: "質問",
  OTHER: "その他",
};

export const FEEDBACK_PRIORITY_LABELS: Record<FeedbackPriority, string> = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  OPEN: "未対応",
  IN_PROGRESS: "対応中",
  ON_HOLD: "保留",
  DONE: "完了",
};

/** 未対応・対応中・保留を「まだ終わっていないもの」として扱う */
export const isOpenFeedback = (status: FeedbackStatus): boolean => status !== "DONE";

export const feedbackSchema = (m: Messages) =>
  z.object({
    title: z.string().trim().min(1, m.validation.required).max(200, m.validation.tooLong(200)),
    body: z.string().trim().min(1, m.validation.required).max(5000, m.validation.tooLong(5000)),
    kind: z.enum(FEEDBACK_KINDS),
    priority: z.enum(FEEDBACK_PRIORITIES),
    status: z.enum(FEEDBACK_STATUSES),
    /** 書いた人への返事。空なら「まだ返していない」 */
    reply: z
      .string()
      .trim()
      .max(5000, m.validation.tooLong(5000))
      .nullish()
      .transform((v) => v || null),
  });

export type FeedbackInput = z.infer<ReturnType<typeof feedbackSchema>>;

/** 一覧・詳細に出す形 */
export interface FeedbackDto {
  id: string;
  title: string;
  body: string;
  kind: FeedbackKind;
  priority: FeedbackPriority;
  status: FeedbackStatus;
  /** 書いた人への返事。null なら、まだ返していない */
  reply: string | null;
  repliedByName: string | null;
  repliedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** 自分がまだ見ていない書き込み・返事か */
  unread: boolean;
}
