"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";

/**
 * 「表示のみ → 編集」に切り替えるボタン。**システム全体で同じ見た目**（2026-09-22 指示）。
 * 大きさは小さいほう（size="sm"）にそろえ、塗りはテーマの帯の色を薄くしたグラデーション
 * （見た目は globals.css の .edit-button）。画面ごとに Button を組み立てない
 */
export function EditButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void;
  /** 省略すると「編集」 */
  label?: string;
  className?: string;
}) {
  const { m } = useI18n();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={["edit-button", className].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <Pencil className="mr-1 size-3.5" />
      {label ?? m.common.edit}
    </Button>
  );
}
