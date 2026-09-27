"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ProductAttachmentDto } from "@/lib/types";

/**
 * 添付ファイルのプレビュー（ポップアップ。2026-09-27 指示）。件名を押すと開く。
 *
 * - 画像はそのまま `<img>` で見せる
 * - テキストは中身を取ってきて `<pre>` で見せる（Shift_JIS はサーバーが UTF-8 に直して返す）
 * - PDF は**取ってきた中身を手元の blob にしてから** `<iframe>` で見せる。サイト全体が
 *   `X-Frame-Options: DENY` なので、API の URL を直接埋め込むとブラウザが断るため
 *   （画面の CSP は `frame-src 'self' blob:` を許している）
 *
 * 閉じるのは右上の×、Escape、窓の外を押したとき
 */
export function AttachmentPreview({
  url,
  attachment,
  onClose,
}: {
  /** 中身の URL（`…/file`）。見せるときは `?preview=1` を付けて取る */
  url: string;
  attachment: ProductAttachmentDto;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = attachment.mime.startsWith("image/")
    ? "image"
    : attachment.mime.startsWith("text/")
      ? "text"
      : "pdf";

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void (async () => {
      const res = await fetch(`${url}?preview=1`);
      if (!alive) return;
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        setError(m.errors.loadFailed(res.status));
        return;
      }
      if (kind === "text") {
        const body = await res.text();
        if (alive) setText(body);
        return;
      }
      const blob = await res.blob();
      if (!alive) return;
      made = URL.createObjectURL(
        kind === "pdf" ? new Blob([blob], { type: "application/pdf" }) : blob,
      );
      setObjectUrl(made);
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url, kind, m]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={attachment.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background flex h-[88vh] w-full max-w-5xl flex-col rounded-md border shadow-lg">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{attachment.title}</p>
            <p className="text-muted-foreground truncate text-xs">{attachment.fileName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* 見ながら落としたくなることがあるので、ここからも落とせるようにする */}
            <a
              href={url}
              data-slot="button"
              data-variant="outline"
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              <Download className="mr-1 size-3.5" />
              {m.attachments.download}
            </a>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              title={m.common.close}
              aria-label={m.common.close}
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="bg-muted/30 min-h-0 flex-1 overflow-auto">
          {error ? (
            <p className="text-destructive p-4 text-sm">{error}</p>
          ) : kind === "text" ? (
            text === null ? (
              <p className="text-muted-foreground p-4 text-sm">{m.common.loading}</p>
            ) : (
              <pre className="p-4 font-mono text-sm break-words whitespace-pre-wrap">{text}</pre>
            )
          ) : objectUrl === null ? (
            <p className="text-muted-foreground p-4 text-sm">{m.common.loading}</p>
          ) : kind === "image" ? (
            <div className="flex min-h-full items-center justify-center p-4">
              {/* 手元の blob なので next/image は通さない */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={objectUrl}
                alt={attachment.title}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : (
            <iframe src={objectUrl} title={attachment.title} className="h-full w-full border-0" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
