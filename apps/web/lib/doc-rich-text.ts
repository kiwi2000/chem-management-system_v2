import type { RichLine, RichMark, RichSpan } from "@chem/shared";

/**
 * エディタ（TipTap／ProseMirror）の形と、保存する形を行き来する。
 *
 * **エディタが吐く形をそのまま保存しない。**
 * ライブラリを替えたときに、作ってあるテンプレートが読めなくなるため。
 * 保存する形は `@chem/shared` の `RichLine` で、こちらが決めたもの。
 *
 * **知らない印は落とす。**エディタ側の拡張が増えても、
 * 保存する形が勝手に育たないようにする。
 */

/** ProseMirror の文書。必要な形だけを書く */
export interface PmNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PmNode[];
}

/** 差込項目の節点の名前。拡張の側と合わせること */
export const FIELD_NODE = "docField";

/** `14pt` のような文字から数を取る。取れなければ指定なし */
function toSize(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(\d+(?:\.\d+)?)\s*pt$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** `#aabbcc` だけを通す。それ以外は指定なし扱い */
function toColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : undefined;
}

function marksOf(node: PmNode): RichMark {
  const out: RichMark = {};
  for (const mk of node.marks ?? []) {
    if (mk.type === "bold") out.bold = true;
    else if (mk.type === "italic") out.italic = true;
    else if (mk.type === "underline") out.underline = true;
    else if (mk.type === "textStyle") {
      const color = toColor(mk.attrs?.color);
      const size = toSize(mk.attrs?.fontSize);
      if (color) out.color = color;
      if (size) out.size = size;
    }
  }
  return out;
}

/** エディタの文書 → 保存する形 */
export function fromEditor(doc: PmNode | null | undefined): RichLine[] {
  const lines: RichLine[] = [];
  for (const para of doc?.content ?? []) {
    if (para.type !== "paragraph") continue;
    const spans: RichSpan[] = [];
    for (const node of para.content ?? []) {
      const mark = marksOf(node);
      if (node.type === "text" && node.text) {
        spans.push({ kind: "text", text: node.text, ...mark });
      } else if (node.type === FIELD_NODE) {
        const field = node.attrs?.field;
        if (typeof field === "string" && field) {
          spans.push({ kind: "field", field, ...mark });
        }
      }
    }
    const align = para.attrs?.textAlign;
    lines.push({
      spans,
      ...(align === "center" || align === "right" ? { align } : {}),
    });
  }
  // 段落が1つも無い文書でも、必ず1行は返す（編集画面が空を扱わずに済む）
  return lines.length > 0 ? lines : [{ spans: [] }];
}

function pmMarks(span: RichSpan): { type: string; attrs?: Record<string, unknown> }[] {
  const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
  if (span.bold) marks.push({ type: "bold" });
  if (span.italic) marks.push({ type: "italic" });
  if (span.underline) marks.push({ type: "underline" });
  if (span.color || span.size) {
    marks.push({
      type: "textStyle",
      attrs: {
        ...(span.color ? { color: span.color } : {}),
        ...(span.size ? { fontSize: `${span.size}pt` } : {}),
      },
    });
  }
  return marks;
}

/** 保存する形 → エディタの文書 */
export function toEditor(lines: RichLine[]): PmNode {
  const content: PmNode[] = (lines.length > 0 ? lines : [{ spans: [] }]).map((line) => {
    const kids: PmNode[] = [];
    for (const span of line.spans) {
      const marks = pmMarks(span);
      if (span.kind === "text") {
        // 空文字は節点として持てない（ProseMirror が受け付けない）
        if (!span.text) continue;
        kids.push({ type: "text", text: span.text, ...(marks.length ? { marks } : {}) });
      } else {
        kids.push({
          type: FIELD_NODE,
          attrs: { field: span.field },
          ...(marks.length ? { marks } : {}),
        });
      }
    }
    return {
      type: "paragraph",
      ...(line.align ? { attrs: { textAlign: line.align } } : {}),
      ...(kids.length ? { content: kids } : {}),
    };
  });
  return { type: "doc", content };
}

/** その行が何も書かれていないか。空のブロックを消す判断に使う */
export function isEmptyLines(lines: RichLine[]): boolean {
  return lines.every((l) =>
    l.spans.every((s) => (s.kind === "text" ? s.text.trim() === "" : false)),
  );
}
