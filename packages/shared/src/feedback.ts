import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * フィードバック。使ってみて気づいたことを記録する、簡単な課題管理。
 *
 * 開発中の窓口として作ったもので、本番を作るときに画面ごと外す。
 * そのため文言はここで日本語のまま持ち、多言語にはしない。
 * 閲覧も更新もログインしている人なら誰でもできる（権限は増やしていない）。
 *
 * **書いた内容は直さない。返信を重ねる。**元の書き込みにも、どの返信にも
 * （自分のものにも）返信できる。直せるのは種別・重要度・ステータスだけ。
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

/** 種別・重要度・ステータス。書いた後でも動かせる（受け取った側が進める） */
export const feedbackStateSchema = () =>
  z.object({
    kind: z.enum(FEEDBACK_KINDS),
    priority: z.enum(FEEDBACK_PRIORITIES),
    status: z.enum(FEEDBACK_STATUSES),
  });

export type FeedbackStateInput = z.infer<ReturnType<typeof feedbackStateSchema>>;

/** 新しく書くとき。タイトルと内容は、書いた後は直せない（返信で補う） */
export const feedbackSchema = (m: Messages) =>
  feedbackStateSchema().extend({
    title: z.string().trim().min(1, m.validation.required).max(200, m.validation.tooLong(200)),
    body: z.string().trim().min(1, m.validation.required).max(5000, m.validation.tooLong(5000)),
  });

export type FeedbackInput = z.infer<ReturnType<typeof feedbackSchema>>;

/** 返信。parentId が無ければ元の書き込みへ、あればその返信への返信 */
export const feedbackCommentSchema = (m: Messages) =>
  z.object({
    body: z.string().trim().min(1, m.validation.required).max(5000, m.validation.tooLong(5000)),
    parentId: z
      .string()
      .trim()
      .nullish()
      .transform((v) => v || null),
  });

export type FeedbackCommentInput = z.infer<ReturnType<typeof feedbackCommentSchema>>;

/** 一覧・詳細に出す形 */
export interface FeedbackDto {
  id: string;
  title: string;
  body: string;
  kind: FeedbackKind;
  priority: FeedbackPriority;
  status: FeedbackStatus;
  /** 返信の数（消したものは数えない） */
  replyCount: number;
  /** いちばん新しい返信。一覧で「いま何が言われているか」を見るため。無ければ null */
  lastReply: { body: string; byName: string | null; at: string } | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** 自分がまだ見ていない書き込み・返信か */
  unread: boolean;
}

/** 返信1件。木になるので parentId を持つ */
export interface FeedbackCommentDto {
  id: string;
  /** null なら元の書き込みへの返信 */
  parentId: string | null;
  /** 消したものは null。下に返信が残っているときだけ場所を残して返す */
  body: string | null;
  byName: string | null;
  createdAt: string;
  /** 見ている本人が消せるか（書いた本人か管理者） */
  canDelete: boolean;
}

export interface FeedbackDetailDto {
  item: FeedbackDto;
  /** 書かれた順。木の組み立ては画面側で行う */
  comments: FeedbackCommentDto[];
}
