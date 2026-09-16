import {
  orgBlockKey,
  compileReplacement,
  isKnownField,
  passesFilter,
  type BlockStyle,
  type BlockWidth,
  type DocumentBlock,
  type DocumentContent,
  bandHasText,
  resolveBandText,
} from "@chem/shared";
import type {
  BandVars,
  BlockMargin,
  DocumentTable,
  PageBand,
  PageBorder,
  PageMargin,
  PageSettings,
  PageTitle,
  DocumentTarget,
  HeadingLevel,
  ImageAlign,
  RichLine,
  RichMark,
  SpacerSize,
} from "@chem/shared";

/**
 * テンプレートと、集めたデータから、紙面の中身を組み立てる。
 *
 * **データの取り方は知らない。**受け取るのは「鍵→値」と「表の中身」だけで、
 * どこから引いたかはこの外（`doc-data.ts`）が決める。
 * 切り離してあるので、ここは試験できる。
 *
 * **できあがりに、直しの手がかりを書かない。**
 * 使えない差込項目があっても、紙面には何も出さず空にする。
 * 紙に「【不明な項目】」と出ると、受け取った相手が困る。
 * 気づくための知らせは `warnings` に分けて返し、画面の側だけに出す。
 */

export interface RenderSpan extends RichMark {
  text: string;
}

export interface RenderLine {
  align?: "left" | "center" | "right";
  spans: RenderSpan[];
}

export interface RenderTable {
  head: string[];
  rows: string[][];
}

/** 幅は紙面まで持ち越す。横に並べるかどうかは、出す側が `groupIntoRows` で決める */
interface RenderBase {
  /** 元のブロックの id。編集画面のプレビューで、選んでいるブロックを枠で示すために要る */
  id?: string;
  width?: BlockWidth;
  /** ブロック全体の字。紙面と編集画面の両方が、これを見て描く */
  style?: BlockStyle;
  /** ブロックの余白（mm）。指定した辺だけ既定を置き換える */
  margin?: BlockMargin;
}

export type RenderBlock =
  | (RenderBase & { kind: "heading"; level: HeadingLevel; lines: RenderLine[] })
  | (RenderBase & { kind: "text"; lines: RenderLine[] })
  | (RenderBase & {
      kind: "fields";
      items: { label: string; value: string }[];
      labelStyle?: BlockStyle;
      gap?: number;
      valueAlign?: "left" | "right";
      labelPosition?: "left" | "right";
      labelWidth?: number;
    })
  /**
   * 組織の項目。**行ごとに寄せを持つ。**
   * 「項目の並び」と別にしているのは、宛名や差出人のように
   * 左・中央・右へ置き分けたいことがあるため
   */
  | (RenderBase & {
      kind: "orgItems";
      items: { label: string; value: string; align: "left" | "center" | "right" }[];
    })
  | (RenderBase & { kind: "table"; caption?: string; head: string[]; rows: string[][] })
  | (RenderBase & { kind: "divider" })
  | (RenderBase & { kind: "spacer"; size: SpacerSize })
  | (RenderBase & { kind: "rowBreak" })
  | (RenderBase & { kind: "pageBreak" })
  | (RenderBase & {
      kind: "signature";
      label: string;
      labelPosition?: "left" | "above";
      gap?: number;
      lineWidth?: number;
    })
  | (RenderBase & {
      kind: "image";
      imageId: string;
      widthMm?: number;
      heightMm?: number;
      align?: ImageAlign;
    });

/** ヘッダー・フッターの帯。差込みは埋めてあり、ページ番号の印だけが残る */
export interface RenderedBand {
  left?: string;
  center?: string;
  right?: string;
  startPage?: number;
  size?: number;
  color?: string;
}

/** 用紙の設定（余白・枠・タイトル・ヘッダー・フッター）。無いものは省く */
export interface RenderedPage {
  margin?: PageMargin;
  border?: PageBorder;
  title?: PageTitle;
  header?: RenderedBand;
  footer?: RenderedBand;
}

export interface RenderedDocument {
  orientation: "portrait" | "landscape";
  /** 紙面ぜんたいの字。ブロックに指定が無いときの既定になる */
  style?: BlockStyle;
  blocks: RenderBlock[];
  /** 画面にだけ出す知らせ。紙面には出さない */
  warnings: string[];
  page?: RenderedPage;
}

export interface RenderInput {
  content: DocumentContent;
  target: DocumentTarget;
  /** 差込項目の鍵 → 出す文字。値が無い項目は入れなくてよい */
  values: Map<string, string>;
  /** 表の鍵 → 全部の列と行。出す列はテンプレートが選ぶ */
  tables: Map<
    DocumentTable,
    { columns: { key: string; label: string }[]; rows: Record<string, string>[] }
  >;
  /**
   * 繰り返しの区間に流す 1 件ごとのデータ（一覧の帳票）。
   * 区間の中は、この並びの数だけ繰り返す。値は紙面ぜんたいの値に重ねる。無ければ区間は出ない
   */
  repeats?: { values: Map<string, string>; tables: RenderInput["tables"] }[];
  /** ヘッダー・フッターの差込みに入れる値。無ければ日時だけ今の時刻で、あとは空 */
  pageVars?: BandVars;
}

function renderBand(band: PageBand | undefined, vars: BandVars): RenderedBand | undefined {
  if (!bandHasText(band)) return undefined;
  const b = band!;
  const text = (s: string | undefined) =>
    s && s.trim() !== "" ? resolveBandText(s, vars) : undefined;
  return {
    ...(text(b.left) !== undefined ? { left: text(b.left) } : {}),
    ...(text(b.center) !== undefined ? { center: text(b.center) } : {}),
    ...(text(b.right) !== undefined ? { right: text(b.right) } : {}),
    ...(b.startPage !== undefined && b.startPage > 1 ? { startPage: b.startPage } : {}),
    ...(b.size !== undefined ? { size: b.size } : {}),
    ...(b.color ? { color: b.color } : {}),
  };
}

/** 用紙の設定を紙面用に。差込みを埋め、空のものは省く */
function renderPage(
  page: PageSettings | undefined,
  vars: BandVars | undefined,
): RenderedPage | undefined {
  if (!page) return undefined;
  const v: BandVars = vars ?? { at: new Date(), template: "", target: "", user: "", locale: "ja" };
  const out: RenderedPage = {};
  if (page.margin) out.margin = page.margin;
  if (page.border) out.border = page.border;
  if (page.title && page.title.text.trim() !== "") out.title = page.title;
  const header = renderBand(page.header, v);
  const footer = renderBand(page.footer, v);
  if (header) out.header = header;
  if (footer) out.footer = footer;
  return Object.keys(out).length === 0 ? undefined : out;
}

function renderLines(
  lines: RichLine[],
  values: Map<string, string>,
  target: DocumentTarget,
  warn: (key: string) => void,
): RenderLine[] {
  return lines.map((line) => ({
    ...(line.align ? { align: line.align } : {}),
    spans: line.spans.map((s) => {
      const loose = s as RichSpanLoose;
      if (loose.kind === "text") return { ...markOnly(loose), text: loose.text ?? "" };
      const key = loose.field ?? "";
      if (!isKnownField(target, key)) warn(key);
      // 値が無いときは空にする。「—」などを入れると、書いた文字と見分けが付かない
      return { ...markOnly(loose), text: values.get(key) ?? "" };
    }),
  }));
}

/** 印だけを取り出す。`text` `field` は文字の側なので混ぜない */
type RichSpanLoose = RichMark & { kind: "text" | "field"; text?: string; field?: string };
function markOnly(v: RichSpanLoose): RichMark {
  const out: RichMark = {};
  if (v.bold) out.bold = true;
  if (v.italic) out.italic = true;
  if (v.underline) out.underline = true;
  if (v.color) out.color = v.color;
  if (v.size) out.size = v.size;
  return out;
}

/** テンプレートと集めたデータから、紙面を組み立てる */
export function renderDocument(input: RenderInput): RenderedDocument {
  const { content, target, values, tables, repeats } = input;
  const unknown = new Set<string>();
  const warn = (key: string) => unknown.add(key);
  const blocks: RenderBlock[] = [];

  const emit = (
    b: DocumentBlock,
    v: Map<string, string>,
    t: RenderInput["tables"],
    suffix: string,
  ) => {
    // 幅は組み立て直さず、そのまま持ち越す（横に並べるのは出す側の仕事）
    for (const out of renderBlock(b, target, v, t, warn)) {
      // 幅と字は、種類によらず同じように持ち回る
      blocks.push({
        ...out,
        // 繰り返した 2 件目からは id に番号を添える（編集画面の枠は 1 件目に付く）
        id: `${b.id}${suffix}`,
        ...(b.width ? { width: b.width } : {}),
        ...(b.style ? { style: b.style } : {}),
        ...(b.margin ? { margin: b.margin } : {}),
      });
    }
  };

  /*
    繰り返しの区間。「始まり」から「終わり」（無ければ最後）までを 1 件分として、
    `repeats` の数だけ流す。入れ子は作らない（中の「始まり」は無視する）
  */
  const src = content.blocks;
  let i = 0;
  while (i < src.length) {
    const b = src[i]!;
    if (b.kind === "repeatEnd") {
      i += 1;
      continue;
    }
    if (b.kind === "repeatStart") {
      const inner: DocumentBlock[] = [];
      let j = i + 1;
      while (j < src.length && src[j]!.kind !== "repeatEnd") {
        if (src[j]!.kind !== "repeatStart") inner.push(src[j]!);
        j += 1;
      }
      (repeats ?? []).forEach((item, n) => {
        const merged = new Map([...values, ...item.values]);
        for (const x of inner) emit(x, merged, item.tables, n === 0 ? "" : `#${n}`);
      });
      i = j + 1;
      continue;
    }
    emit(b, values, tables, "");
    i += 1;
  }

  const warnings: string[] = [];
  if (unknown.size > 0) warnings.push(`unknownFields:${[...unknown].join(",")}`);

  const page = renderPage(content.page, input.pageVars);
  return {
    orientation: content.orientation,
    style: content.style,
    blocks,
    warnings,
    ...(page ? { page } : {}),
  };
}

function renderBlock(
  b: DocumentBlock,
  target: DocumentTarget,
  values: Map<string, string>,
  tables: RenderInput["tables"],
  warn: (key: string) => void,
): RenderBlock[] {
  switch (b.kind) {
    case "heading":
      return [
        { kind: "heading", level: b.level, lines: renderLines(b.lines, values, target, warn) },
      ];
    case "text":
      return [{ kind: "text", lines: renderLines(b.lines, values, target, warn) }];
    /*
      名指しした組織の項目。**差し込む値は集める側が用意している。**
      ここでは鍵を組み立てて引くだけ（読み込みの都合を紙面の組み立てに持ち込まない）
    */
    case "org":
      return [
        {
          kind: "orgItems",
          items: b.items
            .filter((it) => it.item)
            .map((it) => ({
              // 紙に出す見出しは様式が決める。空なら値だけを出す
              label: it.label ?? "",
              value: values.get(orgBlockKey(b.organisationId, it.item)) ?? "",
              align: it.align ?? "left",
            }))
            // 値の無い項目は出さない。空の行が並ぶと、紙面が間延びする
            .filter((x) => x.value !== ""),
        },
      ];
    case "fields":
      return [
        {
          kind: "fields",
          ...(b.labelStyle ? { labelStyle: b.labelStyle } : {}),
          ...(b.gap !== undefined ? { gap: b.gap } : {}),
          ...(b.valueAlign ? { valueAlign: b.valueAlign } : {}),
          ...(b.labelPosition ? { labelPosition: b.labelPosition } : {}),
          ...(b.labelWidth !== undefined ? { labelWidth: b.labelWidth } : {}),
          items: b.items
            // 項目を選んでいない行は、ラベルだけが浮くので出さない
            .filter((it) => it.field)
            .map((it) => {
              if (!isKnownField(target, it.field)) warn(it.field);
              return { label: it.label, value: values.get(it.field) ?? "" };
            }),
        },
      ];
    case "table": {
      const src = tables.get(b.table);
      // データが取れない表は、見出しだけの枠を出さずに丸ごと省く
      if (!src) return [];
      /*
        **並びはテンプレートが決める。**表の定義の順ではなく、選んだ並びで出す。
        定義に無い列（表を変えたあとの残り）は落とす
      */
      const byKey = new Map(src.columns.map((c) => [c.key, c]));
      const cols = b.columns.flatMap((k) => {
        const c = byKey.get(k);
        return c ? [c] : [];
      });

      // 絞り込み。条件が複数あるときは、すべてに当てはまる行だけを出す
      const filters = b.filters ?? [];
      const kept = src.rows.filter((r) => filters.every((f) => passesFilter(r[f.column] ?? "", f)));

      /*
        置き換え。**読めない形は当てずに素通りさせる。**
        打っている途中の半端な正規表現で紙面が壊れると、直しようがない
      */
      const rules = (b.replacements ?? []).flatMap((r) => {
        const re = compileReplacement(r);
        return re ? [{ column: r.column, re, to: r.replacement }] : [];
      });
      const apply = (columnKey: string, cell: string) =>
        rules.reduce((acc, r) => (r.column === columnKey ? acc.replace(r.re, r.to) : acc), cell);

      return [
        {
          kind: "table",
          ...(b.caption ? { caption: b.caption } : {}),
          head: cols.map((c) => c.label),
          rows: kept.map((r) => cols.map((c) => apply(c.key, r[c.key] ?? ""))),
        },
      ];
    }
    case "divider":
      return [{ kind: "divider" }];
    case "spacer":
      return [{ kind: "spacer", size: b.size }];
    case "rowBreak":
      // 紙には何も出さない。横並びを切るためだけのもの
      return [{ kind: "rowBreak" }];
    case "pageBreak":
      return [{ kind: "pageBreak" }];
    // 繰り返しの印は renderDocument が読む。ここまで来るのは区間の外の迷子だけで、紙には出さない
    case "repeatStart":
    case "repeatEnd":
      return [];
    case "signature":
      return [
        {
          kind: "signature",
          label: b.label,
          ...(b.labelPosition ? { labelPosition: b.labelPosition } : {}),
          ...(b.gap !== undefined ? { gap: b.gap } : {}),
          ...(b.lineWidth !== undefined ? { lineWidth: b.lineWidth } : {}),
        },
      ];
    case "image":
      // 画像を選んでいなければ、何も出さない（空の枠を刷らない）
      if (!b.imageId) return [];
      return [
        {
          kind: "image",
          imageId: b.imageId,
          ...(b.widthMm !== undefined ? { widthMm: b.widthMm } : {}),
          ...(b.heightMm !== undefined ? { heightMm: b.heightMm } : {}),
          ...(b.align ? { align: b.align } : {}),
        },
      ];
    default:
      return [];
  }
}
