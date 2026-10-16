"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * チェックボックスが並ぶ選択の一覧の、いちばん上に置く「すべて選択」（2026-10-16 指示）。
 *
 * **1つで全選択と全解除を兼ねる。**全部入っていれば印、一部だけなら「－」（どちらとも言えない印）、
 * 1つも入っていなければ空。押すと、全部入っているときは全部外し、それ以外は全部入れる。
 */
export function SelectAllCheckbox({
  state,
  onSelectAll,
  onClearAll,
  label,
  disabled,
  className,
}: {
  state: "all" | "some" | "none";
  onSelectAll: () => void;
  onClearAll: () => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // 「－」の印は属性では付けられない。毎回描いたあとに入れる
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <label className={cn("flex items-center gap-2 border-b pb-1 font-medium", className)}>
      <input
        ref={ref}
        type="checkbox"
        disabled={disabled}
        checked={state === "all"}
        onChange={() => (state === "all" ? onClearAll() : onSelectAll())}
      />
      {label}
    </label>
  );
}

/** 選んだ数と全体の数から、「すべて選択」の印を決める */
export function selectAllState(picked: number, total: number): "all" | "some" | "none" {
  if (total > 0 && picked >= total) return "all";
  return picked > 0 ? "some" : "none";
}
