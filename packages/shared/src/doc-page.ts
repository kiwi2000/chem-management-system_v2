import { formatDate } from "./doc-file-name";

/**
 * 用紙ぜんたいの設定（2026-09-16 指示）。
 *
 * 余白・枠・タイトル・ヘッダー・フッター。ブロックではなく紙に付くもの。
 * タイトルは 1 ページ目だけ。ヘッダー・フッターは開始ページを決められる
 * （1 ページ目を表紙にするため）。
 */

export const PAGE_BORDER_STYLES = ["solid", "dashed", "dotted", "double"] as const;
export type PageBorderStyle = (typeof PAGE_BORDER_STYLES)[number];

/** 紙の余白（mm）。刷る中身はこの内側 */
export interface PageMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 用紙全体の枠。`insetMm` は紙の端から線までの距離 */
export interface PageBorder {
  style: PageBorderStyle;
  widthMm: number;
  color: string;
  insetMm: number;
}

/** タイトル。1 ページ目の中身の先頭に出る */
export interface PageTitle {
  text: string;
  /** pt。空なら 18 */
  size?: number;
  bold?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
}

/**
 * ヘッダー・フッターの帯。左・中央・右に文字を置ける。
 * 文字には `{ページ}` `{日付}` などの差込みが使える（`PAGE_BAND_VARS`）。
 * `startPage` はこの帯を出し始めるページ（1 から。空なら 1）
 */
export interface PageBand {
  left?: string;
  center?: string;
  right?: string;
  startPage?: number;
  /** pt。空なら 9 */
  size?: number;
  color?: string;
}

export interface PageSettings {
  margin?: PageMargin;
  border?: PageBorder;
  title?: PageTitle;
  header?: PageBand;
  footer?: PageBand;
}

export const DEFAULT_PAGE_MARGIN_MM = 15;
export const DEFAULT_BAND_SIZE = 9;
export const DEFAULT_TITLE_SIZE = 18;

export function pageMarginOf(page: PageSettings | undefined): PageMargin {
  const d = DEFAULT_PAGE_MARGIN_MM;
  return {
    top: page?.margin?.top ?? d,
    right: page?.margin?.right ?? d,
    bottom: page?.margin?.bottom ?? d,
    left: page?.margin?.left ?? d,
  };
}

/** 帯に文字が 1 つでもあるか（無ければ帯そのものを出さない） */
export function bandHasText(band: PageBand | undefined): boolean {
  return !!band && [band.left, band.center, band.right].some((s) => (s ?? "").trim() !== "");
}

/**
 * 帯の差込み。左が日本語、右が英語の名前。どちらで書いても同じ。
 * ページ番号だけは刷るときに紙が数えるので、ここでは置き換えず印のまま残す
 */
export const PAGE_BAND_VARS: { ja: string; en: string; key: BandVarKey }[] = [
  { ja: "ページ", en: "page", key: "page" },
  { ja: "総ページ", en: "pages", key: "pages" },
  { ja: "日付", en: "date", key: "date" },
  { ja: "日時", en: "datetime", key: "datetime" },
  { ja: "時刻", en: "time", key: "time" },
  { ja: "テンプレート", en: "template", key: "template" },
  { ja: "対象", en: "target", key: "target" },
  { ja: "作成者", en: "user", key: "user" },
];
export type BandVarKey =
  "page" | "pages" | "date" | "datetime" | "time" | "template" | "target" | "user";

/** 差込みに入れる値。ページ番号以外 */
export interface BandVars {
  at: Date;
  template: string;
  target: string;
  user: string;
  /** 日付・日時の既定の形。紙面の言語で変える */
  locale: "ja" | "en";
}

/** ページ番号の印。紙が数える（CSS の counter）ので、置き換えたあとの文字にはこれだけが残る */
export const PAGE_TOKEN = "\uE000page\uE001";
export const PAGES_TOKEN = "\uE000pages\uE001";

const PLACEHOLDER = /\{([^{}:]+)(?::([^{}]+))?\}/g;

function keyOf(name: string): BandVarKey | null {
  const t = name.trim();
  return PAGE_BAND_VARS.find((v) => v.ja === t || v.en === t)?.key ?? null;
}

/**
 * 帯の文字の差込みを埋める。知らない差込みはそのまま残す（打っている途中で消えないように）。
 * ページ番号は印（PAGE_TOKEN / PAGES_TOKEN）に置き換える
 */
export function resolveBandText(text: string, vars: BandVars): string {
  const dateFmt = vars.locale === "en" ? "YYYY-MM-DD" : "YYYY/MM/DD";
  return text.replace(PLACEHOLDER, (whole, name: string, fmt: string | undefined) => {
    switch (keyOf(name)) {
      case "page":
        return PAGE_TOKEN;
      case "pages":
        return PAGES_TOKEN;
      case "date":
        return formatDate(vars.at, fmt ?? dateFmt);
      case "datetime":
        return formatDate(vars.at, fmt ?? `${dateFmt} HH:mm`);
      case "time":
        return formatDate(vars.at, fmt ?? "HH:mm");
      case "template":
        return vars.template;
      case "target":
        return vars.target;
      case "user":
        return vars.user;
      default:
        return whole;
    }
  });
}

/** 知らない差込みの名前（画面で知らせる用） */
export function unknownBandPlaceholders(text: string): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (keyOf(m[1]!) === null) bad.push(m[1]!.trim());
  }
  return bad;
}

/**
 * ページ番号の印を含む文字を、CSS の `content` に使える形にする。
 * 例: `1 / 3 ページ` → `counter(page) " / " counter(pages) " ページ"`
 */
export function bandTextToCssContent(text: string): string {
  const quote = (s: string) =>
    `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\A ")}"`;
  const parts: string[] = [];
  const re = new RegExp(`${PAGE_TOKEN}|${PAGES_TOKEN}`, "g");
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push(quote(text.slice(last, m.index)));
    parts.push(m[0] === PAGE_TOKEN ? "counter(page)" : "counter(pages)");
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(quote(text.slice(last)));
  return parts.length === 0 ? '""' : parts.join(" ");
}

/** 画面のプレビュー用。ページ番号の印を見本の数に置き換える */
export function bandTextForPreview(text: string, page = 1, pages = 1): string {
  return text.split(PAGE_TOKEN).join(String(page)).split(PAGES_TOKEN).join(String(pages));
}
