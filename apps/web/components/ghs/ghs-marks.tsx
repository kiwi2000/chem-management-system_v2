"use client";

import { SourceChip, type SourceInfo } from "@/components/source-chip";
import { cn } from "@/lib/utils";

/**
 * GHS の層（LOLI の結び付き・自社判定）に出す印（2026-10-17 指示）。
 * **法規制の画面と同じ印**（データソースの画面で決めた色と文字）を使う。自社判定はデータソース USER の印。
 * 鍵は層のコード（"LOLI"・"OVERRIDE"）。データソースが見つからないときは文字で出す
 */
export type GhsLayerMarks = Record<string, SourceInfo>;

export function GhsLayerChip({
  layer,
  marks,
  fallback,
  title,
  className,
}: {
  layer: string;
  marks: GhsLayerMarks;
  /** データソースが無いときに出す文字 */
  fallback: string;
  /** 乗せたときに出す説明（無ければデータソースのコード） */
  title?: string;
  className?: string;
}) {
  const s = marks[layer];
  if (!s) return <span className={cn("text-[10px]", className)}>{fallback}</span>;
  return (
    <span title={title} className={cn("inline-flex", className)}>
      <SourceChip source={s} />
    </span>
  );
}
