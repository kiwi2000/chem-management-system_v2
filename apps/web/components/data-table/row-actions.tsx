"use client";

import { Eye, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";

/**
 * 一覧の行に置く操作ボタン。
 * 文字だと列幅を食うのでアイコンにし、意味はツールチップと読み上げラベルで伝える。
 */
export function RowActions({
  detailHref,
  onEdit,
  onDelete,
}: {
  /** 詳細画面へ移動する（詳細画面から編集に切り替える） */
  detailHref?: string;
  /** その場のフォームで編集する場合（項目が少ないマスタ） */
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { m } = useI18n();

  return (
    <div className="flex gap-1">
      {detailHref && (
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          title={m.common.detail}
          aria-label={m.common.detail}
          nativeButton={false}
          render={<Link href={detailHref} />}
        >
          <Eye className="size-3.5" />
        </Button>
      )}
      {onEdit && (
        <Button
          variant="outline"
          size="icon"
          className="size-7"
          title={m.common.edit}
          aria-label={m.common.edit}
          onClick={onEdit}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="outline"
          size="icon"
          className="text-destructive size-7"
          title={m.common.delete}
          aria-label={m.common.delete}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
