import { z } from "zod";
import { emailSchema, passwordSchema } from "./auth";
import type { Messages } from "./i18n/ja";
import { PERMISSIONS } from "./permissions";

/** グループの割り当て。空文字は「未所属」として null に倒す */
const groupId = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** 管理者によるユーザー作成。初期パスワードを発行し、初回ログイン時に変更を強制する */
export const userCreateSchema = (m: Messages) =>
  z.object({
    email: emailSchema(m),
    displayName: z.string().trim().max(200).nullable().optional(),
    permissions: z.array(z.enum(PERMISSIONS)),
    initialPassword: passwordSchema(m),
    orgGroupId: groupId,
    newsGroupId: groupId,
  });
export type UserCreateInput = z.infer<ReturnType<typeof userCreateSchema>>;

/** 管理者によるユーザー更新（パスワードの再発行は別API） */
export const userUpdateSchema = (_m: Messages) =>
  z.object({
    displayName: z.string().trim().max(200).nullable().optional(),
    permissions: z.array(z.enum(PERMISSIONS)),
    activeFlag: z.boolean(),
    orgGroupId: groupId,
    newsGroupId: groupId,
  });
export type UserUpdateInput = z.infer<ReturnType<typeof userUpdateSchema>>;

/** 管理者によるパスワード再発行 */
export const passwordResetSchema = (m: Messages) =>
  z.object({
    newPassword: passwordSchema(m),
    /** 次回ログイン時に本人へ変更を強制する（既定 true） */
    mustChangePassword: z.boolean().optional(),
  });
export type PasswordResetInput = z.infer<ReturnType<typeof passwordResetSchema>>;
