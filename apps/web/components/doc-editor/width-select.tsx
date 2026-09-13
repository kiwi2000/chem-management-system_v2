"use client";

import { WIDTH_MAX, WIDTH_MIN, WIDTH_PERCENTS, widthPercent, type BlockWidth } from "@chem/shared";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/**
 * ブロックの幅（％）。
 *
 * **数字を打つ欄と、▼ で出るよく使う値の一覧**（2026-09-13 指示。
 * 「自由(%)」を選んでから別の欄に打つ形をやめ、字の大きさと同じコンボボックスにした）。
 * 一覧のいちばん下に**均等**がある。均等はその行の残りを、均等どうしで等分する。
 * 均等のとき欄は空で、薄く「均等」と出る。欄を空にしても均等になる
 */
export function WidthSelect({
  value,
  onChange,
}: {
  value: BlockWidth | undefined;
  onChange: (w: BlockWidth) => void;
}) {
  const { m } = useI18n();
  const pct = widthPercent(value);
  const [open, setOpen] = useState(false);
  /** 打っている途中の文字。範囲の外や空欄でも、打ち直せるように持つ */
  const [typed, setTyped] = useState(pct === null ? "" : String(pct));
  const root = useRef<HTMLSpanElement>(null);

  // 外から値が変わったら（一覧で選んだなど）欄も合わせる
  useEffect(() => {
    setTyped(pct === null ? "" : String(pct));
  }, [pct]);

  // 外を押したら閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (w: BlockWidth) => {
    onChange(w);
    setOpen(false);
  };

  return (
    <span ref={root} className="relative inline-flex items-stretch">
      <input
        type="number"
        inputMode="numeric"
        min={WIDTH_MIN}
        max={WIDTH_MAX}
        step={1}
        aria-label={m.docEditor.width}
        title={m.docEditor.widthHint}
        placeholder={m.docEditor.widthAuto}
        value={typed}
        onChange={(e) => {
          const raw = e.target.value;
          setTyped(raw);
          if (raw === "") {
            onChange("auto");
            return;
          }
          const n = Number(raw);
          // 範囲の外は幅にしない。打っている途中はそのままにしておく
          if (Number.isInteger(n) && n >= WIDTH_MIN && n <= WIDTH_MAX) onChange(n);
        }}
        onBlur={() => {
          // 打ちかけの半端な値は、いまの幅に戻す
          setTyped(pct === null ? "" : String(pct));
        }}
        className="border-input h-7 w-12 rounded-none border bg-transparent px-1 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`${m.docEditor.width} — ${WIDTH_PERCENTS.map((p) => `${p}%`).join(", ")}, ${m.docEditor.widthAuto}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="border-input text-muted-foreground hover:text-foreground -ml-px flex w-5 items-center justify-center border bg-transparent"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown className="size-3" />
      </button>
      {open && (
        <ul
          role="listbox"
          className="bg-background border-input absolute top-full left-0 z-20 mt-0.5 w-20 border py-1 text-xs shadow"
        >
          {WIDTH_PERCENTS.map((p) => (
            <li key={p} role="option" aria-selected={pct === p}>
              <button
                type="button"
                className={cn(
                  "hover:bg-accent block w-full px-2 py-0.5 text-left",
                  pct === p && "bg-accent",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p)}
              >
                {p}%
              </button>
            </li>
          ))}
          <li role="option" aria-selected={value === "auto"}>
            <button
              type="button"
              className={cn(
                "hover:bg-accent block w-full px-2 py-0.5 text-left",
                value === "auto" && "bg-accent",
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick("auto")}
            >
              {m.docEditor.widthAuto}
            </button>
          </li>
        </ul>
      )}
    </span>
  );
}
