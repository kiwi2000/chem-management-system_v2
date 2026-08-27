import { Node, mergeAttributes } from "@tiptap/core";
import { FIELD_NODE } from "@/lib/doc-rich-text";

/**
 * 文中に混ぜる差込項目。
 *
 * **1文字のかたまりとして扱う。**中身を書き換えられると、
 * `product.code` が `product.cod` になってしまう。
 * 選んで入れたものを、まとめて消すことしかできないようにする。
 *
 * 画面には項目の名前（「製品コード」）を出し、
 * 保存するのは鍵（`product.code`）。名前を変えてもテンプレートは壊れない。
 */
export interface FieldNodeOptions {
  /** 鍵 → 画面に出す名前。テンプレートの対象が変わると入れ替わる */
  labelOf: (key: string) => string;
}

export const DocFieldNode = Node.create<FieldNodeOptions>({
  name: FIELD_NODE,

  // 文中に置くもの。段落の子になる
  group: "inline",
  inline: true,
  // 中に文字を持たない。丸ごと1つとして選ばれる
  atom: true,
  selectable: true,

  addOptions() {
    return { labelOf: (key: string) => key };
  },

  addAttributes() {
    return {
      field: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-field") ?? "",
        renderHTML: (attrs) => ({ "data-field": attrs.field as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[data-field]` }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const key = (node.attrs.field as string) ?? "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        /*
          **画面では名前で出す。**鍵のまま出すと、書いている人には
          何が入るのか読み取れない。印を付けて、ただの文字と見分けられるようにする
        */
        class:
          "bg-primary/10 text-primary rounded px-1 py-0.5 text-[0.9em] whitespace-nowrap select-all",
      }),
      this.options.labelOf(key),
    ];
  },

  renderText({ node }) {
    return this.options.labelOf((node.attrs.field as string) ?? "");
  },
});
