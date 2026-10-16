import { getMessages, type Locale } from "@chem/shared";

/**
 * GHS 分類データの文言。本体の辞書の `ghsData`（2026-10-16 に SDS のモジュールから標準へ移した）。
 * 画面と API の両方から、言語を渡して引く（`data`＝一覧・自社判定・採用順、`ghs`＝取り込み）
 */
export const ghsMessages = (locale: Locale) => getMessages(locale).ghsData;

export type GhsMessages = ReturnType<typeof ghsMessages>;
