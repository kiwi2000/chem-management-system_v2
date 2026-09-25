"use client";

import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { AvatarCropper } from "@/components/avatar-cropper";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

/**
 * システム設定の「題字の横のアイコン」（2026-09-25 指示）。
 *
 * **預ける・外すはその場で効く**（下の「保存」を待たない）。ファイルは設定の JSON に
 * 乗せられないので、別の口（/api/settings/app-icon）へ送る。済んだら預けた時刻を親へ返す
 */
export function AppIconField({
  version,
  onChange,
}: {
  /** いま預けてあるアイコンの時刻。空なら無し */
  version: string;
  onChange: (version: string) => void;
}) {
  const { m } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /** 選んだばかりのファイル。切り出しが済むまで持つ（2026-09-25 指示） */
  const [picked, setPicked] = useState<File | null>(null);

  async function send(req: Promise<Response>, done: (res: Response) => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await req;
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setMessage({ ok: false, text: body?.error.message ?? m.errors.saveFailed(res.status) });
        return;
      }
      await done(res);
    } finally {
      setBusy(false);
    }
  }

  function upload(file: Blob, name: string) {
    const form = new FormData();
    form.append("file", file, name);
    void send(fetch("/api/settings/app-icon", { method: "POST", body: form }), async (res) => {
      const { version: next } = (await res.json()) as { version: string };
      onChange(next);
      setPicked(null);
      setMessage({ ok: true, text: m.settings.headerIconUploaded });
    });
  }

  function remove() {
    void send(fetch("/api/settings/app-icon", { method: "DELETE" }), async () => {
      onChange("");
      setMessage({ ok: true, text: m.settings.headerIconRemoved });
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {version ? (
          // 帯と同じ高さで見せる。DB から返す絵なので next/image は通さない
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/app-icon?v=${encodeURIComponent(version)}`}
            alt=""
            className="bg-header h-9 w-auto rounded-sm border object-contain p-0.5"
          />
        ) : (
          <span className="text-muted-foreground text-sm">{m.settings.headerIconNone}</span>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/tiff"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) {
              setMessage(null);
              setPicked(f);
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {m.settings.headerIconUpload}
        </Button>
        {/* 消すのは表の削除と同じゴミ箱の印だけ（2026-09-25 指示）。言葉はマウスを乗せると出る */}
        {version && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8"
            title={m.settings.headerIconRemove}
            aria-label={m.settings.headerIconRemove}
            disabled={busy}
            onClick={remove}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      {/*
        選んだら、アバターと同じ切り出しを出す。枠は長方形にでき（縦横比のつまみ）、透明のまま。
        画像をまるごと使いたいときのために「切り取らずに使う」も置く
      */}
      {picked && (
        <AvatarCropper
          file={picked}
          saving={busy}
          shape="rect"
          hint={m.settings.headerIconCropHint}
          onDone={(blob) => upload(blob, "icon.png")}
          onCancel={() => setPicked(null)}
          extra={
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => upload(picked, picked.name)}
            >
              {m.settings.headerIconAsIs}
            </Button>
          }
        />
      )}
      {message && (
        <p className={message.ok ? "text-muted-foreground text-xs" : "text-destructive text-xs"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
