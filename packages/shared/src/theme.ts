/**
 * 画面のテーマ。
 * 実際の色は apps/web/app/globals.css の `.theme-*` クラスで定義する。
 * ここに名前を足したら globals.css と i18n の themes ブロックにも足すこと。
 */
export const THEMES = [
  // 標準
  "system",
  "light",
  "dark",
  // 色を基調にしたもの
  "sky",
  "ocean",
  "forest",
  "sepia",
  "sunset",
  "rose",
  // その他
  "contrast",
] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "system";

/** Cookie 名。ログイン前でも選べるようにするため Cookie に持つ */
export const THEME_COOKIE = "chem_theme";

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}

/**
 * <html> に付けるクラス。
 * "system" は OS の設定に従うので、ここでは何も付けずクライアント側で判定する。
 * "light" は既定の配色そのものなので、こちらも付けるクラスは無い。
 */
export function themeClass(theme: Theme): string {
  if (theme === "system" || theme === "light") return "";
  if (theme === "dark") return "dark";
  return `theme-${theme}`;
}

/** 設定画面に出す見本の色（左から 背景・文字・強調）。実際の配色と揃えておく */
export const THEME_SWATCHES: Record<Theme, [string, string, string]> = {
  system: ["oklch(1 0 0)", "oklch(0.145 0 0)", "oklch(0.556 0 0)"],
  light: ["oklch(1 0 0)", "oklch(0.145 0 0)", "oklch(0.205 0 0)"],
  dark: ["oklch(0.145 0 0)", "oklch(0.985 0 0)", "oklch(0.708 0 0)"],
  sky: ["oklch(0.99 0.006 220)", "oklch(0.26 0.03 240)", "oklch(0.6 0.13 230)"],
  ocean: ["oklch(0.985 0.008 230)", "oklch(0.24 0.04 250)", "oklch(0.48 0.13 250)"],
  forest: ["oklch(0.98 0.01 145)", "oklch(0.25 0.03 150)", "oklch(0.44 0.1 150)"],
  sepia: ["oklch(0.968 0.014 85)", "oklch(0.29 0.03 60)", "oklch(0.42 0.06 60)"],
  sunset: ["oklch(0.99 0.012 70)", "oklch(0.28 0.035 50)", "oklch(0.62 0.15 55)"],
  rose: ["oklch(0.985 0.008 350)", "oklch(0.27 0.04 350)", "oklch(0.55 0.17 355)"],
  contrast: ["oklch(1 0 0)", "oklch(0 0 0)", "oklch(0.35 0 0)"],
};

/** Cookie 名。「ヘッダーなどを濃くする」の入切 */
export const HEADER_STRONG_COOKIE = "chem_header_strong";

/**
 * ヘッダーなどを濃くするときに <html> へ付けるクラス。
 * どのテーマでも使えるよう、テーマ側が持つ濃い色（--strong）を流用する。
 */
export const HEADER_STRONG_CLASS = "header-strong";

/** 設定画面の見本に使う「濃くしたときの色」 */
export const THEME_STRONG_SWATCH: Record<Theme, string> = {
  system: "oklch(0.28 0 0)",
  light: "oklch(0.28 0 0)",
  dark: "oklch(0.21 0 0)",
  sky: "oklch(0.35 0.09 240)",
  ocean: "oklch(0.3 0.08 255)",
  forest: "oklch(0.33 0.07 150)",
  sepia: "oklch(0.35 0.05 60)",
  sunset: "oklch(0.4 0.11 50)",
  rose: "oklch(0.36 0.12 355)",
  contrast: "oklch(0 0 0)",
};
