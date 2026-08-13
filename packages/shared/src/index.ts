/**
 * クライアント・サーバー共用のスキーマ／定数。
 * 循環importを避けるため、定数は constants.ts に分離してある（index 経由で参照しないこと）。
 *
 * 各ステップで対象領域のスキーマを追加していく（S5 物質 / S7 製品 / S8 組成 / S9 法規制 / S10 リンク）。
 */
export * from "./auth";
export * from "./constants";
