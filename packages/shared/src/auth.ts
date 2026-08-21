import { z } from "zod";
import type { Messages } from "./i18n/ja";
import { DEFAULT_SETTINGS, type PasswordPolicy } from "./settings";

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
 * 記号を含んでいるか。
 * 設定で文字が並べてあればその中から、空ならば英数字と空白以外すべてを記号とみなす。
 */
function hasSymbol(value: string, chars: string): boolean {
  const list = [...chars];
  if (list.length === 0) return /[^A-Za-z0-9\s]/.test(value);
  return [...value].some((c) => list.includes(c));
}

/**
 * パスワードの決まり。長さと文字種はシステム設定で決める。
 * 決まりを渡さないときは既定（12文字以上・英字と数字）で見る。
 *
 * すでに使われているパスワードには効かない。決まりを厳しくした途端に
 * 誰もログインできなくなるのを避けるため、これから設定するものだけを見る。
 */
export const passwordSchema = (m: Messages, policy?: PasswordPolicy) => {
  const p = policy ?? DEFAULT_SETTINGS;
  return z
    .string()
    .min(p.passwordMinLength, m.validation.passwordMin(p.passwordMinLength))
    .max(200, m.validation.passwordMax)
    .superRefine((v, ctx) => {
      const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      if (p.passwordRequireLetter && !/[A-Za-z]/.test(v)) add(m.validation.passwordNeedsLetter);
      if (p.passwordRequireDigit && !/[0-9]/.test(v)) add(m.validation.passwordNeedsDigit);
      if (p.passwordRequireSymbol && !hasSymbol(v, p.passwordSymbolChars)) {
        add(
          p.passwordSymbolChars === ""
            ? m.validation.passwordNeedsSymbol
            : m.validation.passwordNeedsSymbolOf(p.passwordSymbolChars),
        );
      }
      if (p.passwordRequireMixedCase && !(/[a-z]/.test(v) && /[A-Z]/.test(v))) {
        add(m.validation.passwordNeedsMixedCase);
      }
    });
};

/** 決まりを日本語の一文にする。入力欄の説明に出す */
export function describePasswordPolicy(m: Messages, policy?: PasswordPolicy): string {
  const p = policy ?? DEFAULT_SETTINGS;
  const kinds: string[] = [];
  if (p.passwordRequireLetter) kinds.push(m.validation.kindLetter);
  if (p.passwordRequireDigit) kinds.push(m.validation.kindDigit);
  if (p.passwordRequireSymbol) {
    kinds.push(
      p.passwordSymbolChars === ""
        ? m.validation.kindSymbol
        : m.validation.kindSymbolOf(p.passwordSymbolChars),
    );
  }
  if (p.passwordRequireMixedCase) kinds.push(m.validation.kindMixedCase);
  return kinds.length === 0
    ? m.validation.passwordRuleLengthOnly(p.passwordMinLength)
    : m.validation.passwordRule(p.passwordMinLength, kinds.join("・"));
}

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

export const changePasswordSchema = (m: Messages, policy?: PasswordPolicy) =>
  z
    .object({
      currentPassword: z.string().min(1, m.validation.currentPasswordRequired),
      newPassword: passwordSchema(m, policy),
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
