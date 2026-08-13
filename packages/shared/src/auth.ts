import { z } from "zod";

/**
 * 認証（自前・外部サービス非依存）のバリデーション。
 * 高セキュリティ運用のため、パスワードは長さ重視のポリシーとする。
 */

/** ログインID＝メールアドレス。突合は小文字化して行う */
export const emailSchema = z
  .string()
  .trim()
  .min(1, "メールアドレスは必須です")
  .max(255)
  .email("メールアドレスの形式が正しくありません");

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * パスワードポリシー: 12文字以上（長さを最重視）。
 * 加えて英字・数字を各1文字以上（記号は任意・日本語入力も可）。
 */
export const passwordSchema = z
  .string()
  .min(12, "パスワードは12文字以上にしてください")
  .max(200, "パスワードが長すぎます")
  .refine((v) => /[A-Za-z]/.test(v), "英字を1文字以上含めてください")
  .refine((v) => /[0-9]/.test(v), "数字を1文字以上含めてください");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "パスワードは必須です").max(200),
  /** MFA有効ユーザーのワンタイムコード（6桁） */
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "6桁の数字を入力してください")
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードは必須です"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "新しいパスワードが一致しません",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "現在のパスワードと同じものは使用できません",
    path: ["newPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** 管理者によるユーザー作成（初期パスワードを発行し、初回ログイン時に変更を強制） */
export const userCreateSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().max(200).optional().nullable(),
  role: z.enum(["SYSTEM_ADMIN", "PRIVILEGED", "NON_PRIVILEGED"]),
  canEdit: z.boolean().optional(),
  initialPassword: passwordSchema,
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

/** 管理者によるパスワード再発行 */
export const passwordResetSchema = z.object({
  newPassword: passwordSchema,
});

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
