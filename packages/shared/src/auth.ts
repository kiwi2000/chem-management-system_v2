import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 認証（自前・外部サービス非依存）の入力チェック。
 * エラー文言を多言語化するため、スキーマは辞書を受け取る関数として定義する。
 * 呼び出し側は `loginSchema(m)` のように、その場のロケールの辞書を渡す。
 */

/** ログインID＝メールアドレス。突合は小文字化して行う */
export const emailSchema = (m: Messages) =>
  z.string().trim().min(1, m.validation.emailRequired).max(255).email(m.validation.emailFormat);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * パスワードポリシー: 12文字以上（長さを最重視）。
 * 加えて英字・数字を各1文字以上（記号は任意・日本語入力も可）。
 */
export const passwordSchema = (m: Messages) =>
  z
    .string()
    .min(12, m.validation.passwordMin)
    .max(200, m.validation.passwordMax)
    .refine((v) => /[A-Za-z]/.test(v), m.validation.passwordNeedsLetter)
    .refine((v) => /[0-9]/.test(v), m.validation.passwordNeedsDigit);

export const loginSchema = (m: Messages) =>
  z.object({
    email: emailSchema(m),
    password: z.string().min(1, m.validation.passwordRequired).max(200),
    /** MFA有効ユーザーのワンタイムコード（6桁） */
    totp: z
      .string()
      .trim()
      .regex(/^\d{6}$/, m.validation.totpFormat)
      .optional(),
  });
export type LoginInput = z.infer<ReturnType<typeof loginSchema>>;

export const changePasswordSchema = (m: Messages) =>
  z
    .object({
      currentPassword: z.string().min(1, m.validation.currentPasswordRequired),
      newPassword: passwordSchema(m),
      confirmPassword: z.string(),
    })
    .refine((v) => v.newPassword === v.confirmPassword, {
      message: m.validation.passwordMismatch,
      path: ["confirmPassword"],
    })
    .refine((v) => v.newPassword !== v.currentPassword, {
      message: m.validation.passwordSameAsCurrent,
      path: ["newPassword"],
    });
export type ChangePasswordInput = z.infer<ReturnType<typeof changePasswordSchema>>;

/** 管理者によるユーザー作成（初期パスワードを発行し、初回ログイン時に変更を強制） */
export const userCreateSchema = (m: Messages) =>
  z.object({
    email: emailSchema(m),
    displayName: z.string().trim().max(200).optional().nullable(),
    role: z.enum(["SYSTEM_ADMIN", "PRIVILEGED", "NON_PRIVILEGED"]),
    canEdit: z.boolean().optional(),
    initialPassword: passwordSchema(m),
  });
export type UserCreateInput = z.infer<ReturnType<typeof userCreateSchema>>;

/** 管理者によるパスワード再発行 */
export const passwordResetSchema = (m: Messages) => z.object({ newPassword: passwordSchema(m) });

/** セキュリティ関連の定数（値の変更は運用ポリシーの変更を意味する） */
export const AUTH_POLICY = {
  /** 連続失敗でロックする回数 */
  maxFailedLogins: 5,
  /** ロックアウト時間（分） */
  lockoutMinutes: 15,
  /** セッション有効期間（時間）。無操作でこの時間を過ぎると再ログイン */
  sessionHours: 12,
  /** Cookie名 */
  sessionCookieName: "chem_session",
} as const;
