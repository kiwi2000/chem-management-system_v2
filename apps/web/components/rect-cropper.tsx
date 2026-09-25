"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/** 画像を出す枠の最大の大きさ（px）。小さい画像はここまで引き伸ばして見せる（切り出しは元の画素で行う） */
const VIEW_MAX_W = 360;
const VIEW_MAX_H = 280;
/** 切り取り枠の最小の辺（画面の px） */
const MIN_SIDE = 12;
/** 仕上がりの長い辺の上限。サーバーでもう一度縮めるので、ここは大きめでよい */
const OUT_MAX = 1024;

type Box = { x: number; y: number; w: number; h: number };
/** つかんだ所。n/s/e/w は辺、ne などは角、move は枠の中 */
type Grip = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

const GRIPS: { grip: Exclude<Grip, "move">; className: string; cursor: string }[] = [
  { grip: "nw", className: "-left-1.5 -top-1.5", cursor: "nwse-resize" },
  { grip: "n", className: "left-1/2 -top-1.5 -translate-x-1/2", cursor: "ns-resize" },
  { grip: "ne", className: "-right-1.5 -top-1.5", cursor: "nesw-resize" },
  { grip: "e", className: "-right-1.5 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { grip: "se", className: "-right-1.5 -bottom-1.5", cursor: "nwse-resize" },
  { grip: "s", className: "left-1/2 -bottom-1.5 -translate-x-1/2", cursor: "ns-resize" },
  { grip: "sw", className: "-left-1.5 -bottom-1.5", cursor: "nesw-resize" },
  { grip: "w", className: "-left-1.5 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
];

/**
 * 長方形の切り取り（題字のアイコン。2026-09-25 指示）。
 *
 * **画像を丸ごと見せ、その上の枠の辺・角をつかんで範囲を決める。**枠の中をつかむと枠が動く。
 * 最初の枠は画像全体（そのまま「この範囲にする」を押せば、画像をまるごと使える）。
 * 透明は残し、PNG で返す（ロゴの透明を帯の色に透かすため）
 */
export function RectCropper({
  file,
  saving,
  hint,
  onDone,
  onCancel,
}: {
  file: File;
  saving: boolean;
  hint: string;
  onDone: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const { m } = useI18n();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ grip: Grip; x: number; y: number; start: Box } | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [view, setView] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: 0, h: 0 });
  const [failed, setFailed] = useState(false);

  /** 読み込み。画面の大きさを決め、枠を画像全体にする（後始末の回の結果は捨てる） */
  useEffect(() => {
    let alive = true;
    setFailed(false);
    setView(null);
    const u = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      if (!alive) return;
      imgRef.current = el;
      const k = Math.min(VIEW_MAX_W / el.width, VIEW_MAX_H / el.height);
      const w = Math.round(el.width * k);
      const h = Math.round(el.height * k);
      setView({ w, h });
      setBox({ x: 0, y: 0, w, h });
      setUrl(u);
    };
    el.onerror = () => {
      if (alive) setFailed(true);
    };
    el.src = u;
    return () => {
      alive = false;
      URL.revokeObjectURL(u);
    };
  }, [file]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, grip: Grip) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { grip, x: e.clientX, y: e.clientY, start: box };
  }

  /** 動かした量を枠に当てる。画像の外へは出さず、最小の大きさより小さくしない */
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || !view) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    const s = d.start;
    if (d.grip === "move") {
      setBox({
        ...s,
        x: Math.min(Math.max(s.x + dx, 0), view.w - s.w),
        y: Math.min(Math.max(s.y + dy, 0), view.h - s.h),
      });
      return;
    }
    let left = s.x;
    let top = s.y;
    let right = s.x + s.w;
    let bottom = s.y + s.h;
    if (d.grip.includes("w")) left = Math.min(Math.max(s.x + dx, 0), right - MIN_SIDE);
    if (d.grip.includes("e")) right = Math.max(Math.min(right + dx, view.w), left + MIN_SIDE);
    if (d.grip.includes("n")) top = Math.min(Math.max(s.y + dy, 0), bottom - MIN_SIDE);
    if (d.grip.includes("s")) bottom = Math.max(Math.min(bottom + dy, view.h), top + MIN_SIDE);
    setBox({ x: left, y: top, w: right - left, h: bottom - top });
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  /** 枠の範囲を、元の画素で切り出す（長い辺は OUT_MAX まで） */
  function confirm() {
    const img = imgRef.current;
    if (!img || !view) return;
    const k = img.width / view.w;
    const sx = box.x * k;
    const sy = box.y * k;
    const sw = box.w * k;
    const sh = box.h * k;
    const fit = Math.min(1, OUT_MAX / Math.max(sw, sh));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw * fit));
    out.height = Math.max(1, Math.round(sh * fit));
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
    out.toBlob((b) => b && onDone(b), "image/png");
  }

  if (failed) return <p className="text-destructive text-sm">{m.preferences.avatarTypeError}</p>;
  if (!view || !url) return null;

  return (
    <div className="space-y-3">
      <div
        className="bg-muted relative overflow-hidden rounded-md border select-none"
        style={{ width: view.w, height: view.h }}
        // 枠・角でつかんでも、動きはここへ伝わってくる（つかんだ要素が指を捕まえている）
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* 見せるだけの絵。切り出しは読み込んだ元の画像から行う */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
        {/* 枠。外側は大きな影で暗くして、仕上がりの範囲を見せる */}
        <div
          role="presentation"
          className="absolute cursor-move touch-none border-2 border-white outline outline-1 outline-black/60"
          style={{
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
          }}
          onPointerDown={(e) => onPointerDown(e, "move")}
        >
          {GRIPS.map((g) => (
            <div
              key={g.grip}
              className={cn(
                "absolute size-3 touch-none border border-black/60 bg-white",
                g.className,
              )}
              style={{ cursor: g.cursor }}
              onPointerDown={(e) => onPointerDown(e, g.grip)}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={saving} onClick={confirm}>
          {m.preferences.avatarApply}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          {m.common.cancel}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}
