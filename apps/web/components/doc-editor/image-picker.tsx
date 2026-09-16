"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ImageAssetDto, ListResponse } from "@/lib/types";

/**
 * 画像ブロックの「画像を選ぶ」欄（2026-09-16 指示）。
 * いま選んでいる画像の小さな絵と名前を出し、押すとライブラリの一覧（サムネイル）から選べる。
 * その場でアップロードもできる（ライブラリの画面へ移らなくて済むように）。
 */
export function ImagePickerField({
  value,
  onChange,
}: {
  /** 画像ライブラリの id。空なら未選択 */
  value: string;
  onChange: (imageId: string) => void;
}) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ImageAssetDto | null>(null);

  // 選んでいる画像の名前と大きさを出す（id だけでは何の画像か分からない）
  useEffect(() => {
    if (!value) {
      setCurrent(null);
      return;
    }
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/images/${value}?meta=1`).catch(() => null);
      if (!res?.ok || !alive) return;
      const body = (await res.json()) as ImageAssetDto;
      if (alive) setCurrent(body);
    })();
    return () => {
      alive = false;
    };
  }, [value]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {value ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- DB から出す絵 */}
          <img
            src={`/api/images/${value}?thumb=1`}
            alt=""
            className="h-16 max-w-40 border object-contain"
          />
          <span className="text-sm">
            {current?.name ?? ""}
            {current && (
              <span className="text-muted-foreground ml-2 text-xs">
                {current.width}×{current.height}px
              </span>
            )}
          </span>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {m.images.change}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange("")}>
            {m.images.clear}
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted-foreground text-sm">{m.docEditor.imageNone}</span>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {m.images.pick}
          </Button>
        </>
      )}
      <ImagePickerDialog
        open={open}
        onOpenChange={setOpen}
        onPick={(id) => {
          onChange(id);
          setOpen(false);
        }}
      />
    </div>
  );
}

/** ライブラリの一覧（サムネイル）。押して選ぶ。上にアップロードの欄 */
export function ImagePickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (imageId: string) => void;
}) {
  const { m } = useI18n();
  const [items, setItems] = useState<ImageAssetDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/images?pageSize=200").catch(() => null);
    if (!res?.ok) {
      if (res && redirectIfUnauthorized(res)) return;
      setError(m.errors.loadFailed(res?.status ?? 0));
      return;
    }
    setItems(((await res.json()) as ListResponse<ImageAssetDto>).items);
  }, [m]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/images", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        { added: { id: string }[]; rejected: { name: string; reason: string }[] } | ApiError | null;
      if (!body || !("added" in body)) {
        if (redirectIfUnauthorized(res)) return;
        setError((body as ApiError | null)?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      if (body.rejected.length > 0) {
        setError(body.rejected.map((r) => m.images.rejected(r.name, r.reason)).join(" / "));
      }
      await load();
      // 1 枚だけ入れたなら、そのまま選ぶ（もう一度押させない）
      if (body.added.length === 1 && files.length === 1) onPick(body.added[0]!.id);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="bg-popover text-popover-foreground ring-foreground/10 fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[min(95vw,56rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl p-5 shadow-lg ring-1 outline-none">
          <Dialog.Title className="text-base font-semibold">{m.images.pickTitle}</Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-1 text-xs">
            {m.images.uploadHint}
          </Dialog.Description>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? m.images.uploading : m.images.upload}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => void upload(e.target.files)}
            />
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              {m.common.cancel}
            </Button>
            {error && <span className="text-destructive text-xs">{error}</span>}
          </div>
          <div className="mt-3">
            {items === null ? (
              <p className="text-muted-foreground text-sm">{m.common.loading}</p>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground text-sm">{m.images.empty}</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
                {items.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => onPick(img.id)}
                    className="hover:border-primary flex flex-col items-center gap-1 rounded-none border p-2 text-left"
                    title={`${img.name} ${img.width}×${img.height}px`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- DB から出す絵 */}
                    <img
                      src={`/api/images/${img.id}?thumb=1`}
                      alt=""
                      className="h-24 w-full object-contain"
                    />
                    <span className="w-full truncate text-xs">{img.name}</span>
                    <span className="text-muted-foreground text-[11px]">
                      {img.width}×{img.height}px
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
