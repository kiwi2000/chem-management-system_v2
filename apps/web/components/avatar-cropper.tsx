"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";

/** 切り出す大きさ。表示は小さな丸なので、これで足りる */
const AVATAR_SIDE = 256;
/** 画面に出す枠の大きさ */
const VIEW = 256;
const MAX_SCALE = 4;

/**
 * アバターの切り出し。
 *
 * 選んだ画像を正方形の枠に収め、つまみで拡大縮小、つかんで位置合わせをする。
 * 中央を機械的に切ると顔が外れることがあるので、どこを使うかは本人に決めてもらう。
 */
export function AvatarCropper({
  file,
  saving,
  onDone,
  onCancel,
}: {
  file: File;
  saving: boolean;
  onDone: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const { m } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  // 切り出す正方形の中心（元画像の座標）
  const [center, setCenter] = useState({ x: 0, y: 0 });

  /**
   * 選ばれた画像を読み込む。中心は真ん中から始める。
   * 後始末でURLを無効にするので、読み込みが終わる前に片付いた回の結果は捨てる
   * （開発時は副作用が2回走り、1回目の後始末で失敗と判定されてしまうため）。
   */
  useEffect(() => {
    let alive = true;
    setReady(false);
    setFailed(false);
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      if (!alive) return;
      imgRef.current = el;
      setCenter({ x: el.width / 2, y: el.height / 2 });
      setScale(1);
      setReady(true);
    };
    el.onerror = () => {
      if (alive) setFailed(true);
    };
    el.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  /** いまの倍率で切り出す正方形の一辺（元画像の画素数） */
  const cropSide = useCallback(() => {
    const img = imgRef.current;
    if (!img) return 0;
    return Math.min(img.width, img.height) / scale;
  }, [scale]);

  /** 枠が画像からはみ出さないところまで戻す */
  const clamp = useCallback(
    (c: { x: number; y: number }) => {
      const img = imgRef.current;
      if (!img) return c;
      const half = cropSide() / 2;
      return {
        x: Math.min(Math.max(c.x, half), img.width - half),
        y: Math.min(Math.max(c.y, half), img.height - half),
      };
    },
    [cropSide],
  );

  /** 枠の中身を描く。実際に保存されるのと同じ範囲 */
  const draw = useCallback(
    (target: HTMLCanvasElement, side: number) => {
      const img = imgRef.current;
      const ctx = target.getContext("2d");
      if (!img || !ctx) return;
      const s = cropSide();
      const c = clamp(center);
      // 透過のある画像でも白地にする（丸く切り抜くので、透けると背景と混ざる）
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, side, side);
      ctx.drawImage(img, c.x - s / 2, c.y - s / 2, s, s, 0, 0, side, side);
    },
    [center, clamp, cropSide],
  );

  useEffect(() => {
    if (ready && canvasRef.current) draw(canvasRef.current, VIEW);
  }, [ready, draw]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const from = dragRef.current;
    if (!from) return;
    // 画面上の移動量を、元画像の画素数に直す
    const k = cropSide() / VIEW;
    const dx = (e.clientX - from.x) * k;
    const dy = (e.clientY - from.y) * k;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setCenter((c) => clamp({ x: c.x - dx, y: c.y - dy }));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function confirm() {
    const out = document.createElement("canvas");
    out.width = AVATAR_SIDE;
    out.height = AVATAR_SIDE;
    draw(out, AVATAR_SIDE);
    out.toBlob((b) => b && onDone(b), "image/jpeg", 0.85);
  }

  if (failed) return <p className="text-destructive text-sm">{m.preferences.avatarTypeError}</p>;

  return (
    <div className="space-y-3">
      <div
        className="bg-muted relative overflow-hidden rounded-md border"
        style={{ width: VIEW, height: VIEW }}
      >
        <canvas
          ref={canvasRef}
          width={VIEW}
          height={VIEW}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="cursor-grab touch-none active:cursor-grabbing"
        />
        {/* 実際に出るのは丸なので、丸の外を暗くして仕上がりを見せる */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md"
          style={{
            background: "rgba(0,0,0,0.45)",
            // closest-side にしないと、円が四隅までの距離を基準にして小さくなる
            WebkitMaskImage:
              "radial-gradient(circle closest-side at center, transparent 99.5%, black 100%)",
            maskImage:
              "radial-gradient(circle closest-side at center, transparent 99.5%, black 100%)",
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="avatar-zoom" className="text-sm">
          {m.preferences.avatarZoom}
        </label>
        <input
          id="avatar-zoom"
          type="range"
          min={1}
          max={MAX_SCALE}
          step={0.05}
          value={scale}
          onChange={(e) => {
            setScale(Number(e.target.value));
            // 倍率が下がると枠が広がるので、はみ出さない位置へ戻す
            setCenter((c) => clamp(c));
          }}
          style={{ width: VIEW - 80 }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!ready || saving} onClick={confirm}>
          {m.preferences.avatarApply}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          {m.common.cancel}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{m.preferences.avatarCropHint}</p>
    </div>
  );
}
