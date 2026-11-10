import { z } from "zod";
import { emailSchema, passwordSchema } from "./auth";
import type { PasswordPolicy } from "./settings";
import type { Messages } from "./i18n/ja";

/** グループの割り当て。空文字は「未設定」として null に倒す */
const groupId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/**
 * 所属する組織の id（S31。必ず 1 つ）
 */
const organisationId = (m: Messages) => z.string().trim().min(1, m.validation.required);

/**
 * 入る権限グループの id（S31。いくつでも、0 でもよい）。
 * 省略は「変えない」ではなく「無し」。画面は常に全部を送る
 */
const groupIds = z.array(z.string().trim().min(1)).transform((v) => [...new Set(v)]);

/** 管理者によるユーザー作成。初期パスワードを発行し、初回ログイン時に変更を強制する */
export const userCreateSchema = (m: Messages, policy?: PasswordPolicy) =>
  z.object({
    email: emailSchema(m),
    displayName: z.string().trim().max(200).nullable().optional(),
    initialPassword: passwordSchema(m, policy),
    newsGroupId: groupId,
    organisationId: organisationId(m),
    groupIds,
  });
export type UserCreateInput = z.infer<ReturnType<typeof userCreateSchema>>;

/** 管理者によるユーザー更新（パスワードの再発行は別API） */
export const userUpdateSchema = (m: Messages) =>
  z.object({
    displayName: z.string().trim().max(200).nullable().optional(),
    activeFlag: z.boolean(),
    newsGroupId: groupId,
    organisationId: organisationId(m),
    groupIds,
  });
export type UserUpdateInput = z.infer<ReturnType<typeof userUpdateSchema>>;

/** 管理者によるパスワード再発行 */
export const passwordResetSchema = (m: Messages, policy?: PasswordPolicy) =>
  z.object({
    newPassword: passwordSchema(m, policy),
    /** 次回ログイン時に本人へ変更を強制する（既定 true） */
    mustChangePassword: z.boolean().optional(),
  });
export type PasswordResetInput = z.infer<ReturnType<typeof passwordResetSchema>>;
