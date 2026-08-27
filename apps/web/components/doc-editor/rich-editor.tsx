"use client";

import { fieldsFor, type DocumentTarget, type RichLine } from "@chem/shared";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-text-style/color";
import { FontSize } from "@tiptap/extension-text-style/font-size";
import { TextAlign } from "@tiptap/extension-text-align";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline as UnderlineIcon,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { DocFieldNode } from "@/components/doc-editor/field-node";
import { Button } from "@/components/ui/button";
import { fromEditor, toEditor, type PmNode } from "@/lib/doc-rich-text";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/** 選べる文字の大きさ（ポイント）。刻みを決めておかないと、そろわない紙面になる */
const SIZES = [9, 10, 11, 12, 14, 16, 18, 24] as const;

/** 選べる色。自由な色は紙に出したときに読めないことがあるので、決め打ちにする */
const COLORS = [
  { value: "", labelJa: "既定", labelEn: "Default" },
  { value: "#111827", labelJa: "黒", labelEn: "Black" },
  { value: "#b91c1c", labelJa: "赤", labelEn: "Red" },
  { value: "#1d4ed8", labelJa: "青", labelEn: "Blue" },
  { value: "#15803d", labelJa: "緑", labelEn: "Green" },
  { value: "#6b7280", labelJa: "灰", labelEn: "Grey" },
] as const;

const TOOL = "h-7 px-2";

/**
 * 文章を書く欄。
 *
 * **保存する形はこの部品の外で決まっている。**受け取るのも返すのも `RichLine[]` で、
 * TipTap の形は中に閉じ込める（`doc-rich-text.ts`）。
 * 替えたくなったときに、テンプレートを作り直さずに済むようにするため。
 */
export function RichEditor({
  value,
  onChange,
  target,
  placeholder,
  minHeight = "5rem",
}: {
  value: RichLine[];
  onChange: (lines: RichLine[]) => void;
  /** 差込項目の選択肢を決める。テンプレートの対象 */
  target: DocumentTarget;
  placeholder?: string;
  minHeight?: string;
}) {
  const { m, locale } = useI18n();
  const fields = useMemo(() => fieldsFor(target), [target]);
  const labelOf = useMemo(() => {
    const map = new Map(fields.map((f) => [f.key, locale === "en" ? f.labelEn : f.labelJa]));
    // 対象を変えて使えなくなった項目は、鍵のまま出す。気づけるように
    return (key: string) => map.get(key) ?? key;
  }, [fields, locale]);

  const editor = useEditor({
    /*
      **サーバー側では描かない。**エディタは DOM を触るので、
      Next.js の事前描画で警告が出る
    */
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // 帳票の中では使わないもの。出すと紙面の作りが崩れる
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      TextStyle,
      Color,
      FontSize,
      TextAlign.configure({ types: ["paragraph"] }),
      DocFieldNode.configure({ labelOf }),
    ],
    content: toEditor(value) as never,
    onUpdate: ({ editor: ed }) => {
      onChange(fromEditor(ed.getJSON() as PmNode));
    },
    editorProps: {
      attributes: {
        class: "outline-none px-2 py-1 text-sm",
        style: `min-height:${minHeight}`,
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
  });

  /*
    差込項目の名前は、対象を変えると入れ替わる。
    拡張の設定を差し替えたうえで、いま出ているものを描き直す
  */
  useEffect(() => {
    if (!editor) return;
    editor.extensionManager.extensions
      .filter((e) => e.name === DocFieldNode.name)
      .forEach((e) => {
        (e.options as { labelOf: (k: string) => string }).labelOf = labelOf;
      });
    editor.view.dispatch(editor.state.tr);
  }, [editor, labelOf]);

  if (!editor) return null;

  return (
    <div className="border-input rounded-none border">
      <Toolbar editor={editor} fields={fields} locale={locale} m={m} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  fields,
  locale,
  m,
}: {
  editor: Editor;
  fields: ReturnType<typeof fieldsFor>;
  locale: string;
  m: ReturnType<typeof useI18n>["m"];
}) {
  const mark = (active: boolean) => cn(TOOL, active && "bg-accent");
  return (
    <div className="border-input flex flex-wrap items-center gap-1 border-b px-1 py-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={m.docEditor.bold}
        aria-pressed={editor.isActive("bold")}
        className={mark(editor.isActive("bold"))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={m.docEditor.italic}
        aria-pressed={editor.isActive("italic")}
        className={mark(editor.isActive("italic"))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label={m.docEditor.underline}
        aria-pressed={editor.isActive("underline")}
        className={mark(editor.isActive("underline"))}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </Button>

      <span className="bg-border mx-1 h-5 w-px" />

      {(
        [
          ["left", AlignLeft, m.docEditor.alignLeft],
          ["center", AlignCenter, m.docEditor.alignCenter],
          ["right", AlignRight, m.docEditor.alignRight],
        ] as const
      ).map(([v, Icon, label]) => (
        <Button
          key={v}
          type="button"
          size="sm"
          variant="ghost"
          aria-label={label}
          aria-pressed={editor.isActive({ textAlign: v })}
          className={mark(editor.isActive({ textAlign: v }))}
          onClick={() => editor.chain().focus().setTextAlign(v).run()}
        >
          <Icon className="size-4" />
        </Button>
      ))}

      <span className="bg-border mx-1 h-5 w-px" />

      <select
        className="border-input h-7 rounded-none border bg-transparent px-1 text-sm"
        aria-label={m.docEditor.size}
        value={(editor.getAttributes("textStyle").fontSize as string) ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontSize(v).run();
          else editor.chain().focus().unsetFontSize().run();
        }}
      >
        <option value="">{m.docEditor.sizeDefault}</option>
        {SIZES.map((s) => (
          <option key={s} value={`${s}pt`}>
            {s}
          </option>
        ))}
      </select>

      <select
        className="border-input h-7 rounded-none border bg-transparent px-1 text-sm"
        aria-label={m.docEditor.color}
        value={((editor.getAttributes("textStyle").color as string) ?? "").toLowerCase()}
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setColor(v).run();
          else editor.chain().focus().unsetColor().run();
        }}
      >
        {COLORS.map((c) => (
          <option key={c.value} value={c.value}>
            {locale === "en" ? c.labelEn : c.labelJa}
          </option>
        ))}
      </select>

      <span className="bg-border mx-1 h-5 w-px" />

      {/* 差込項目。選んだ瞬間に入り、選択は戻す（続けて入れられるように） */}
      <select
        className="border-input h-7 rounded-none border bg-transparent px-1 text-sm"
        aria-label={m.docEditor.insertField}
        value=""
        onChange={(e) => {
          const key = e.target.value;
          if (!key) return;
          editor
            .chain()
            .focus()
            .insertContent({ type: "docField", attrs: { field: key } })
            .run();
          e.target.value = "";
        }}
      >
        <option value="">{m.docEditor.insertField}</option>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {locale === "en" ? f.labelEn : f.labelJa}
          </option>
        ))}
      </select>
    </div>
  );
}
