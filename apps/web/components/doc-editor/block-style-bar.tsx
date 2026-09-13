"use client";

import {
  BLOCK_BORDER_STYLES,
  BLOCK_PATTERNS,
  DEFAULT_FONT,
  DOCUMENT_FONTS,
  type BlockBorderStyle,
  type BlockPattern,
  type BlockStyle,
  type FontKey,
} from "@chem/shared";
import { Bold, Italic, PaintBucket, Underline } from "lucide-react";
import { useState } from "react";
import { FontSizeInput } from "@/components/doc-editor/font-size-input";
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

/** 色を選ばない状態。`input[type=color]` は空を持てないので、黒を「指定なし」と見なす */
const NO_COLOR = "#000000";

export function BlockStyleBar({
  value,
  onChange,
  level = "block",
  defaultFontLabel,
  fontLabel,
}: {
  value: BlockStyle | undefined;
  onChange: (next: BlockStyle | undefined) => void;
  /**
   * どの段の指定か。
   * **紙面ぜんたいには「合わせる先」が無い**ので、書体を必ず1つ選ばせる
   */
  level?: "document" | "block";
  /** 「指定なし」に出す言葉 */
  defaultFontLabel?: string;
  /** フォントの欄の上に小さく出す名前。ブロックの見出し行で使う（紙面ぜんたいの帯は外に名前がある） */
  fontLabel?: string;
}) {
  const { m } = useI18n();
  const st = value ?? {};
  /** 背景・模様・枠線の欄を出しているか。どれかが決まっていれば最初から出す */
  const hasDecor = !!(st.background || st.pattern || st.borderStyle);
  const [decorOpen, setDecorOpen] = useState(hasDecor);
  const showDecor = decorOpen || hasDecor;

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

  const fontSelect = (
    <select
      aria-label={m.docEditor.font}
      title={m.docEditor.font}
      value={level === "document" ? (st.family ?? DEFAULT_FONT) : (st.family ?? "")}
      onChange={(e) => patch({ family: (e.target.value || undefined) as FontKey | undefined })}
      className="border-input bg-background h-8 w-24 rounded-none border px-1 text-xs"
    >
      {/* 合わせる先があるのはブロックだけ。紙面ぜんたいはここがいちばん外 */}
      {level === "block" && <option value="">{defaultFontLabel ?? m.docEditor.fontDefault}</option>}
      {DOCUMENT_FONTS.map((f) => (
        <option key={f.key} value={f.key}>
          {m.docEditor.fonts[f.key]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-wrap items-end gap-1">
      {fontLabel ? (
        <span className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-[10px] leading-none">{fontLabel}</span>
          {fontSelect}
        </span>
      ) : (
        fontSelect
      )}
      {/* 大きさは打ち込む欄（候補つき）。決まった段だけだと 13 や 10.5 にできない。上に小さく「サイズ」 */}
      <span className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-[10px] leading-none">
          {m.docEditor.sizeShort}
        </span>
        <FontSizeInput
          value={st.size}
          onChange={(size) => patch({ size })}
          label={`${m.docEditor.fontSize} — ${m.docEditor.fontSizeHint}`}
          placeholder={m.docEditor.fontSizeDefault}
          className="border-input bg-background h-8 w-14 rounded-none border px-1 text-xs"
        />
      </span>
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
      {/* 背景・模様・枠線。押すと欄が出る（いつも出すと帯が長くなりすぎる。2026-09-13 指示） */}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={m.docEditor.decor}
        title={m.docEditor.decor}
        aria-pressed={showDecor}
        className={cn(showDecor && "bg-accent text-foreground")}
        onClick={() => setDecorOpen((v) => !v)}
      >
        <PaintBucket className="size-4" />
      </Button>
      {showDecor && (
        <>
          <Small label={m.docEditor.background}>
            <span className="flex items-center gap-0.5">
              <input
                type="color"
                aria-label={m.docEditor.background}
                title={m.docEditor.background}
                value={st.background ?? NO_BACKGROUND}
                onChange={(e) =>
                  patch({
                    background: e.target.value === NO_BACKGROUND ? undefined : e.target.value,
                  })
                }
                className="border-input h-8 w-8 cursor-pointer border bg-transparent p-0.5"
              />
              {st.background && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-1 text-xs"
                  onClick={() => patch({ background: undefined })}
                >
                  {m.docEditor.decorClear}
                </Button>
              )}
            </span>
          </Small>
          <Small label={m.docEditor.pattern}>
            <select
              aria-label={m.docEditor.pattern}
              value={st.pattern ?? ""}
              onChange={(e) =>
                patch({
                  pattern: (e.target.value || undefined) as BlockPattern | undefined,
                  // 模様をやめたら、模様の色も要らない
                  ...(e.target.value ? {} : { patternColor: undefined }),
                })
              }
              className="border-input bg-background h-8 rounded-none border px-1 text-xs"
            >
              <option value="">{m.docEditor.patterns.none}</option>
              {BLOCK_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {m.docEditor.patterns[p]}
                </option>
              ))}
            </select>
          </Small>
          {st.pattern && (
            <Small label={m.docEditor.patternColor}>
              <input
                type="color"
                aria-label={m.docEditor.patternColor}
                title={m.docEditor.patternColor}
                value={st.patternColor ?? DEFAULT_PATTERN_COLOR}
                onChange={(e) => patch({ patternColor: e.target.value })}
                className="border-input h-8 w-8 cursor-pointer border bg-transparent p-0.5"
              />
            </Small>
          )}
          <Small label={m.docEditor.border}>
            <select
              aria-label={m.docEditor.border}
              value={st.borderStyle ?? ""}
              onChange={(e) =>
                patch({
                  borderStyle: (e.target.value || undefined) as BlockBorderStyle | undefined,
                  // 枠をやめたら、太さと色も要らない
                  ...(e.target.value ? {} : { borderWidth: undefined, borderColor: undefined }),
                })
              }
              className="border-input bg-background h-8 rounded-none border px-1 text-xs"
            >
              <option value="">{m.docEditor.borders.none}</option>
              {BLOCK_BORDER_STYLES.map((b) => (
                <option key={b} value={b}>
                  {m.docEditor.borders[b]}
                </option>
              ))}
            </select>
          </Small>
          {st.borderStyle && (
            <>
              <Small label={m.docEditor.borderWidth}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.1}
                  max={5}
                  step={0.1}
                  aria-label={m.docEditor.borderWidth}
                  placeholder="0.3"
                  value={st.borderWidth ?? ""}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      patch({ borderWidth: undefined });
                      return;
                    }
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    patch({ borderWidth: Math.min(5, Math.max(0.1, n)) });
                  }}
                  className="border-input bg-background h-8 w-14 rounded-none border px-1 text-xs"
                />
              </Small>
              <Small label={m.docEditor.borderColor}>
                <input
                  type="color"
                  aria-label={m.docEditor.borderColor}
                  title={m.docEditor.borderColor}
                  value={st.borderColor ?? NO_COLOR}
                  onChange={(e) =>
                    patch({ borderColor: e.target.value === NO_COLOR ? undefined : e.target.value })
                  }
                  className="border-input h-8 w-8 cursor-pointer border bg-transparent p-0.5"
                />
              </Small>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** 背景を選ばない状態。白を「指定なし」と見なす（背景の色の欄は空を持てない） */
const NO_BACKGROUND = "#ffffff";
/** 模様の色を選んでいないときの色（薄い灰色） */
const DEFAULT_PATTERN_COLOR = "#9ca3af";

/** 欄の上に小さく名前を出す入れもの（ブロックの見出し行と同じ形） */
function Small({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[10px] leading-none">{label}</span>
      {children}
    </span>
  );
}
