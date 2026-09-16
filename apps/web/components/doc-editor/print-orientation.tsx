import {
  bandTextToCssContent,
  DEFAULT_BAND_SIZE,
  DEFAULT_FONT,
  fontStack,
  pageMarginOf,
  type PageMargin,
} from "@chem/shared";
import type { RenderedPage } from "@/lib/doc-render";

/**
 * 紙の向き・余白・ヘッダー・フッター。
 *
 * **`@page` は CSS でしか指定できない。**要素の style には書けないので、
 * テンプレートごとに違う向き・余白を出すには、その場でスタイルを差し込むしかない。
 *
 * ヘッダー・フッターは `@page` の余白の箱（@top-center など）に置く。ページ番号は
 * 紙が数える（`counter(page)`）。開始ページより前の紙は名前付きの紙（pg-00 など）にして、
 * そこでは帯を出さない（DocumentSheet が中身をその名前で包む）。
 *
 * 枠が余白より紙の端に近いときは、`@page` の余白を枠の位置まで詰め、
 * 中身の側に足りないぶんの余白（padding）を持たせる（紙の外には何も置けないため）
 */
export function PrintOrientation({ orientation }: { orientation: "portrait" | "landscape" }) {
  return <PrintPageStyle orientation={orientation} />;
}

/** `@page` の余白。枠が余白より外にあるときは、枠の位置まで詰める */
export function printPageMargin(page: RenderedPage | undefined): PageMargin {
  const m = pageMarginOf(page);
  const inset = page?.border?.insetMm;
  if (inset === undefined) return m;
  return {
    top: Math.min(m.top, inset),
    right: Math.min(m.right, inset),
    bottom: Math.min(m.bottom, inset),
    left: Math.min(m.left, inset),
  };
}

function bandBoxes(
  side: "top" | "bottom",
  band: RenderedPage["header"],
  family: string | undefined,
): string {
  if (!band) return "";
  const font = `font-size: ${band.size ?? DEFAULT_BAND_SIZE}pt; ${band.color ? `color: ${band.color};` : ""} ${family ? `font-family: ${family};` : ""} white-space: pre;`;
  const box = (pos: string, text: string | undefined, align: string) =>
    text && text !== ""
      ? `@${side}-${pos} { content: ${bandTextToCssContent(text)}; ${font} text-align: ${align}; vertical-align: middle; }`
      : "";
  return [
    box("left", band.left, "left"),
    box("center", band.center, "center"),
    box("right", band.right, "right"),
  ].join("\n");
}

function bandNone(side: "top" | "bottom"): string {
  return ["left", "center", "right"].map((pos) => `@${side}-${pos} { content: none; }`).join(" ");
}

export function PrintPageStyle({
  orientation,
  page,
  family,
}: {
  orientation: "portrait" | "landscape";
  page?: RenderedPage;
  /** 紙面の字（帯も同じ字で刷る） */
  family?: string;
}) {
  const m = printPageMargin(page);
  const inner = pageMarginOf(page);
  const stack = fontStack(family ?? DEFAULT_FONT);
  const head = bandBoxes("top", page?.header, stack);
  const foot = bandBoxes("bottom", page?.footer, stack);
  const css = [
    `@page { size: A4 ${orientation}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; ${head} ${foot} }`,
    // 帯を出さない紙（開始ページより前）。pg-<ヘッダー><フッター>（1 = 出す）
    `@page pg-00 { ${bandNone("top")} ${bandNone("bottom")} }`,
    `@page pg-10 { ${bandNone("bottom")} }`,
    `@page pg-01 { ${bandNone("top")} }`,
    `@media print {`,
    `  .doc-pg-00 { page: pg-00; } .doc-pg-10 { page: pg-10; } .doc-pg-01 { page: pg-01; } .doc-pg-11 { page: pg-11; }`,
    // 余白は @page が持つ。枠のぶんだけ詰めたときは、その差を中身の余白で補う
    `  .doc-sheet { padding: ${inner.top - m.top}mm ${inner.right - m.right}mm ${inner.bottom - m.bottom}mm ${inner.left - m.left}mm !important; }`,
    `}`,
  ].join("\n");
  return <style>{css}</style>;
}
