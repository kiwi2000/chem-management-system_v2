import {
  orgBlockKey,
  compileReplacement,
  isKnownField,
  passesFilter,
  type BlockWidth,
  type DocumentBlock,
  type DocumentContent,
} from "@chem/shared";
import type { DocumentTable, DocumentTarget, RichLine, RichMark } from "@chem/shared";

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
  width?: BlockWidth;
}

export type RenderBlock =
  | (RenderBase & { kind: "heading"; level: 1 | 2 | 3; lines: RenderLine[] })
  | (RenderBase & { kind: "text"; lines: RenderLine[] })
  | (RenderBase & { kind: "fields"; items: { label: string; value: string }[] })
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
  | (RenderBase & { kind: "spacer"; size: "sm" | "md" | "lg" })
  | (RenderBase & { kind: "rowBreak" })
  | (RenderBase & { kind: "pageBreak" })
  | (RenderBase & { kind: "signature"; label: string });

export interface RenderedDocument {
  orientation: "portrait" | "landscape";
  blocks: RenderBlock[];
  /** 画面にだけ出す知らせ。紙面には出さない */
  warnings: string[];
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
  const { content, target, values, tables } = input;
  const unknown = new Set<string>();
  const warn = (key: string) => unknown.add(key);
  const blocks: RenderBlock[] = [];

  for (const b of content.blocks) {
    // 幅は組み立て直さず、そのまま持ち越す（横に並べるのは出す側の仕事）
    for (const out of renderBlock(b, target, values, tables, warn)) {
      blocks.push(b.width ? { ...out, width: b.width } : out);
    }
  }

  const warnings: string[] = [];
  if (unknown.size > 0) warnings.push(`unknownFields:${[...unknown].join(",")}`);

  return { orientation: content.orientation, blocks, warnings };
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
    case "signature":
      return [{ kind: "signature", label: b.label }];
    default:
      return [];
  }
}
