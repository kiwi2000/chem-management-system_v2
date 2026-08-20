import { z } from "zod";

/**
 * 公開の状態。物質と製品で共通。
 *
 * 作った直後は作成中で、他の人には見せず組成の候補にも出さない。
 * 承認が必要かどうかはシステム設定で切り替える。
 *   必要 … 作成中 →（申請）→ 承認待ち →（承認）→ 公開済 ／（却下）→ 却下
 *   不要 … 作成中 →（発行）→ 公開済
 * 廃番かどうか（status）とは別の軸。
 */
export const PUBLISH_STATES = ["DRAFT", "PENDING", "REJECTED", "PUBLISHED"] as const;
export type PublishState = (typeof PUBLISH_STATES)[number];

/** 他の人が使える状態か（組成の候補・一覧の上の表に出る条件） */
export const isPublished = (state: PublishState): boolean => state === "PUBLISHED";

/** 状態を変える操作。履歴にもこの名前で残す */
export const APPROVAL_ACTIONS = [
  "submit",
  "withdraw",
  "approve",
  "reject",
  "publish",
  "unpublish",
] as const;
export type ApprovalActionInput = (typeof APPROVAL_ACTIONS)[number];

/**
 * その操作をしてよい状態か。
 * 承認が要るかどうかで submit と publish を出し分けるのは呼び出し側の役目。
 */
export const ALLOWED_FROM: Record<ApprovalActionInput, readonly PublishState[]> = {
  submit: ["DRAFT", "REJECTED"],
  withdraw: ["PENDING"],
  approve: ["PENDING"],
  reject: ["PENDING"],
  publish: ["DRAFT", "REJECTED"],
  unpublish: ["PUBLISHED"],
};

/** 操作したあとの状態 */
export const NEXT_STATE: Record<ApprovalActionInput, PublishState> = {
  submit: "PENDING",
  withdraw: "DRAFT",
  approve: "PUBLISHED",
  reject: "REJECTED",
  publish: "PUBLISHED",
  unpublish: "DRAFT",
};

/** 履歴に残すときの操作名（DBの enum に合わせる） */
export const HISTORY_ACTION: Record<ApprovalActionInput, string> = {
  submit: "SUBMIT",
  withdraw: "WITHDRAW",
  approve: "APPROVE",
  reject: "REJECT",
  publish: "APPROVE",
  unpublish: "UNPUBLISH",
};

/** 状態を変える要求。一覧からまとめて操作できるよう複数の ID を受ける */
export const publishActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(APPROVAL_ACTIONS),
  comment: z.string().trim().max(500).optional(),
});

export type PublishActionInput = z.infer<typeof publishActionSchema>;
