"use client";

import type { BlockStyle } from "@chem/shared";
import { Bold, Italic, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/**
 * ブロック全体の字を決める小さな帯。
 *
 * **どの種類のブロックにも付ける。**表や項目の並びにも、
 * 「注記だけ小さく」「表題だけ色を変える」という要りようがある。
 *
 * 文章と見出しでは、この上に**文字ごとの指定**を重ねられる。
 * ブロックの指定が土台で、文字ごとの指定が勝つ（CSS の親子と同じ）。
 *
 * **空の指定は持たない。**何も選んでいない状態は `undefined` に戻し、
 * 保存した様式に「既定と同じ値」が残らないようにする
 */

/** 選べる大きさ（ポイント）。細かすぎると選ぶのが手間なので、よく使うものだけ */
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24] as const;

/** 色を選ばない状態。`input[type=color]` は空を持てないので、黒を「指定なし」と見なす */
const NO_COLOR = "#000000";

export function BlockStyleBar({
  value,
  onChange,
}: {
  value: BlockStyle | undefined;
  onChange: (next: BlockStyle | undefined) => void;
}) {
  const { m } = useI18n();
  const st = value ?? {};

  /** 中身が空になったら、指定そのものを外す */
  const patch = (next: Partial<BlockStyle>) => {
    const merged: BlockStyle = { ...st, ...next };
    for (const k of Object.keys(merged) as (keyof BlockStyle)[]) {
      const v = merged[k];
      if (v === undefined || v === false || v === "") delete merged[k];
    }
    onChange(Object.keys(merged).length === 0 ? undefined : merged);
  };

  const toggle = (key: "bold" | "italic" | "underline", Icon: typeof Bold, label: string) => (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      aria-pressed={st[key] === true}
      className={cn(st[key] && "bg-accent text-foreground")}
      onClick={() => patch({ [key]: !st[key] })}
    >
      <Icon className="size-4" />
    </Button>
  );

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={m.docEditor.fontSize}
        title={m.docEditor.fontSize}
        value={st.size ?? ""}
        onChange={(e) =>
          patch({ size: e.target.value === "" ? undefined : Number(e.target.value) })
        }
        className="border-input bg-background h-8 rounded-none border px-1 text-xs"
      >
        <option value="">{m.docEditor.fontSizeDefault}</option>
        {SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {toggle("bold", Bold, m.docEditor.bold)}
      {toggle("italic", Italic, m.docEditor.italic)}
      {toggle("underline", Underline, m.docEditor.underline)}
      <input
        type="color"
        aria-label={m.docEditor.fontColor}
        title={m.docEditor.fontColor}
        value={st.color ?? NO_COLOR}
        onChange={(e) => patch({ color: e.target.value === NO_COLOR ? undefined : e.target.value })}
        className="border-input h-8 w-8 cursor-pointer border bg-transparent p-0.5"
      />
      {/* 色を戻す口。色の選択欄そのものからは「指定なし」に戻せない */}
      {st.color && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-1 text-xs"
          onClick={() => patch({ color: undefined })}
        >
          {m.docEditor.fontColorClear}
        </Button>
      )}
    </div>
  );
}
