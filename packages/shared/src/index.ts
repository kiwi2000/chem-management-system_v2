/**
 * クライアント・サーバー共用のスキーマ／定数／文言。
 * 循環importを避けるため、定数は constants.ts、文言は i18n/ に分離してある
 * （それぞれのモジュール同士は index を経由せず直接 import すること）。
 *
 * 各ステップで対象領域のスキーマを追加していく（S5 物質 / S7 製品 / S8 組成 / S9 法規制 / S10 リンク）。
 */
export * from "./admin";
export * from "./auth";
export * from "./background";
export * from "./constants";
export * from "./group";
export * from "./i18n";
export * from "./metal-factor";
export * from "./news";
export * from "./permissions";
export * from "./product";
export * from "./settings";
export * from "./substance";
export * from "./table";
export * from "./theme";
