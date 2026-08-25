"use client";

import { X } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { useOutsideClose } from "@/lib/use-outside-close";
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_PRIORITY_LABELS,
  FEEDBACK_STATUS_LABELS,
  type FeedbackDto,
} from "@chem/shared";

/**
 * 書き込みの全文を、その場で開く小窓。
 *
 * 一覧では内容も返事も3行で打ち切っている。行の高さがばらばらだと
 * 一覧として読めなくなるためだが、そのぶん続きが見えない。
 * ここで全文を読めるようにする。
 *
 * 物質の小窓（substance-peek）と同じ作りにしてある。
 * 覗くだけのものは、どの画面でも同じ開きかた・閉じかたであってほしい。
 */
export function FeedbackPeek({
  item,
  onClose,
}: {
  /** 開いている書き込み。null なら閉じている */
  item: FeedbackDto | null;
  onClose: () => void;
}) {
  const { m, locale } = useI18n();

  const close = useCallback(() => onClose(), [onClose]);
  const boxRef = useOutsideClose<HTMLDivElement>(item !== null, close);

  // Esc で閉じる。読むだけのものなので、閉じる手間は限りなく小さくしておく
  useEffect(() => {
    if (!item) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, close]);

  if (!item) return null;

  const when = (iso: string) => new Date(iso).toLocaleString(locale);

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="書き込みの詳細"
      className="bg-background animate-in slide-in-from-right-8 fade-in fixed top-14 right-0 bottom-0 z-30 flex w-[30rem] max-w-full flex-col border-l shadow-lg duration-200"
    >
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="flex-1 truncate text-sm font-semibold">書き込みの詳細</h2>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={m.common.close}
          aria-label={m.common.close}
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        <div>
          <h3 className="text-base font-semibold">{item.title}</h3>
          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{FEEDBACK_KIND_LABELS[item.kind]}</Badge>
            <Badge variant="secondary">{FEEDBACK_PRIORITY_LABELS[item.priority]}</Badge>
            <Badge variant="secondary">{FEEDBACK_STATUS_LABELS[item.status]}</Badge>
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            {item.createdByName ?? "—"} ／ {when(item.createdAt)}
          </p>
        </div>

        {/* 改行をそのまま出す。箇条書きで書かれることが多い */}
        <section className="space-y-1">
          <h4 className="text-muted-foreground text-xs font-medium">内容</h4>
          <p className="break-words whitespace-pre-wrap">{item.body}</p>
        </section>

        <section className="space-y-1">
          <h4 className="text-muted-foreground text-xs font-medium">返事</h4>
          {item.reply ? (
            <>
              <p className="break-words whitespace-pre-wrap">{item.reply}</p>
              <p className="text-muted-foreground text-xs">
                {item.repliedByName ?? "—"}
                {item.repliedAt ? ` ／ ${when(item.repliedAt)}` : ""}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">まだ返事はありません</p>
          )}
        </section>

        <p className="text-muted-foreground border-t pt-3 text-xs">
          更新日時 {when(item.updatedAt)}
        </p>
      </div>
    </div>
  );
}
