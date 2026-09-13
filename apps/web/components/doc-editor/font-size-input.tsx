"use client";

import { useId } from "react";

/**
 * 字の大きさ（ポイント）を打ち込む欄。
 *
 * 決まった段から選ぶ形だと「13 にしたい」「10.5 にしたい」ができない（2026-09-13 指示）ので、
 * 数字を直接打てる欄にし、よく使う値は候補として出す（欄を押すと並ぶ）。
 * 空なら「既定」（紙面ぜんたい、または文字ごとの指定なし）に戻る。
 * 表題を大きく出したいことがある（2026-09-13 指示）ので上は 200 まで。下は 6
 */
const PRESETS = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72] as const;
const MIN = 6;
const MAX = 200;

export function FontSizeInput({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  /** ポイント。未指定は undefined */
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  /** 読み上げと吹き出しに使う名前 */
  label: string;
  /** 空のときに薄く出す言葉（「既定」など） */
  placeholder?: string;
  className?: string;
}) {
  const listId = useId();
  return (
    <>
      <input
        type="number"
        inputMode="decimal"
        list={listId}
        min={MIN}
        max={MAX}
        step={0.5}
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
        className={className}
      />
      <datalist id={listId}>
        {PRESETS.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}
