"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 字の大きさ（ポイント）を打ち込む欄。
 *
 * 決まった段から選ぶ形だと「13 にしたい」「10.5 にしたい」ができない（2026-09-13 指示）ので、
 * 数字を直接打てる欄にし、よく使う値は右の ▼ を押すと並ぶ。
 * （ブラウザ任せの候補（datalist）は、印は出るのに押しても何も出ないことがあったので、
 * 自前の一覧にした。2026-09-13）
 * 空なら「既定」（紙面ぜんたい、または文字ごとの指定なし）に戻る。
 * 表題を大きく出したいことがあるので上は 200 まで。下は 6
 */
const FONT_PRESETS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72] as const;

export function FontSizeInput({
  value,
  onChange,
  label,
  placeholder,
  className,
  presets = FONT_PRESETS,
  min: MIN = 6,
  max: MAX = 200,
  step = 0.5,
}: {
  /** ポイント（または mm）。未指定は undefined */
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  /** 読み上げと吹き出しに使う名前 */
  label: string;
  /** 空のときに薄く出す言葉（「既定」など） */
  placeholder?: string;
  className?: string;
  /** ▼ で出す候補。字の大きさ以外（余白の高さなど）でも同じ欄を使えるように差し替えられる */
  presets?: readonly number[];
  min?: number;
  max?: number;
  step?: number;
}) {
  const PRESETS = presets;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  // 外を押したら閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex items-stretch">
      <input
        type="number"
        inputMode="decimal"
        min={MIN}
        max={MAX}
        step={step}
        aria-label={label}
        title={label}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(undefined);
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(n);
        }}
        onBlur={(e) => {
          // 範囲の外は端に寄せる（打っている途中では触らない）
          const n = Number(e.target.value);
          if (e.target.value === "" || !Number.isFinite(n)) return;
          const clamped = Math.min(MAX, Math.max(MIN, n));
          if (clamped !== n) onChange(clamped);
        }}
        className={cn(
          className,
          // ▼ の一覧があるので、数の上下の矢印は出さない（2026-09-13 指示）
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        )}
      />
      {/* よく使う値の一覧。押すとその値が入る */}
      <button
        type="button"
        aria-label={`${label} — ${PRESETS.join(", ")}`}
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
          className="bg-background border-input absolute top-full left-0 z-20 mt-0.5 max-h-56 w-20 overflow-auto border py-1 text-xs shadow"
        >
          {PRESETS.map((n) => (
            <li key={n} role="option" aria-selected={value === n}>
              <button
                type="button"
                className={cn(
                  "hover:bg-accent block w-full px-2 py-0.5 text-left",
                  value === n && "bg-accent",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
