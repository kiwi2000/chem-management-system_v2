/**
 * 画面が使う API レスポンスの型。
 * 各ステップで対象の DTO を追記していく（S5 物質 / S7 製品 …）。
 */

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

/** GET /api/me — 画面の出し分け用。認可の判断はサーバー側で別途行う */
export interface MeDto {
  id: string;
  email: string;
  displayName: string | null;
  role: "SYSTEM_ADMIN" | "PRIVILEGED" | "NON_PRIVILEGED";
  canEdit: boolean;
  privileged: boolean;
  preferredLocale: string | null;
}
