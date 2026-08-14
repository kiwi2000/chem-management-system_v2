/**
 * 画面の背景。テーマ（配色）とは独立して選ぶ。
 * 実際の見た目は apps/web/app/globals.css の `.bg-*` クラスで定義する。
 *
 * 2種類ある。
 * - 模様: 全面に薄く敷く幾何学模様。CSSのグラデーションだけで描く
 * - 挿絵: 画面の隅に1枚だけ置く絵。SVGをCSSに埋め込む（外部から取ってこない）
 *
 * どちらも表・カード・フォームの下には出ない。数字が読みにくくなるため。
 */
export const BACKGROUNDS = [
  "none",
  // 模様
  "grid",
  "dots",
  "diagonal",
  "washi",
  // 挿絵
  "beaker",
  "molecule",
  "flask",
] as const;
export type Background = (typeof BACKGROUNDS)[number];

export const DEFAULT_BACKGROUND: Background = "none";

/** 模様と挿絵で設定画面の並びを分ける */
export const PATTERN_BACKGROUNDS: Background[] = ["grid", "dots", "diagonal", "washi"];
export const PICTURE_BACKGROUNDS: Background[] = ["beaker", "molecule", "flask"];

/** Cookie 名。ログイン前でも選べるようにするため Cookie に持つ */
export const BACKGROUND_COOKIE = "chem_bg";

export function isBackground(v: unknown): v is Background {
  return typeof v === "string" && (BACKGROUNDS as readonly string[]).includes(v);
}

/** <html> に付けるクラス。"none" は何も付けない */
export function backgroundClass(background: Background): string {
  return background === "none" ? "" : `bg-${background}`;
}
