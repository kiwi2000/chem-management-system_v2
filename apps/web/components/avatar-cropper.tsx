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
 * 長方形（題字のアイコン）のとき。枠の長い辺を画面でこの大きさに出す。
 * 仕上がりは短い辺を RECT_SHORT px にする（帯では高さ 36px で出るので、高精細の画面でも足りる）
 */
const RECT_VIEW = 320;
const RECT_SHORT = 128;
/** 縦横比（横 ÷ 縦）の範囲。縦長 1:2 から横長 4:1 まで。つまみは比の対数で動かす */
const ASPECT_MIN = 0.5;
const ASPECT_MAX = 4;

const clampAspect = (a: number) => Math.min(Math.max(a, ASPECT_MIN), ASPECT_MAX);

/**
 * アバターの切り出し。
 *
 * 選んだ画像を正方形の枠に収め、つまみで拡大縮小、つかんで位置合わせをする。
 * 中央を機械的に切ると顔が外れることがあるので、どこを使うかは本人に決めてもらう。
 *
 * 題字の横のアイコンでも使う（2026-09-25 指示）。そのときは `shape="rect"`:
 * 丸の覆いを付けず、透明を白で埋めず、PNG で返す（ロゴの透明を残すため）。
 * **枠は長方形にできる**（縦横比のつまみ。最初は画像そのものの比）。
 * `extra` には切り出しの横に並べるボタン（「切り取らずに使う」など）を渡せる
 */
export function AvatarCropper({
  file,
  saving,
  onDone,
  onCancel,
  shape = "circle",
  hint,
  extra,
}: {
  file: File;
  saving: boolean;
  onDone: (blob: Blob) => void;
  onCancel: () => void;
  shape?: "circle" | "rect";
  /** 下に出す説明。既定はアバターの説明 */
  hint?: string;
  extra?: React.ReactNode;
}) {
  const rect = shape === "rect";
  const { m } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  /** 枠の縦横比（横 ÷ 縦）。丸は常に 1 */
  const [aspect, setAspect] = useState(1);
  // 切り出す枠の中心（元画像の座標）
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
      // 長方形なら、最初は画像そのものの比（横長のロゴがそのまま枠に収まる）
      setAspect(rect ? clampAspect(el.width / el.height) : 1);
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
  }, [file, rect]);

  /** 画面の枠の大きさ（px） */
  const viewW = rect ? (aspect >= 1 ? RECT_VIEW : Math.round(RECT_VIEW * aspect)) : VIEW;
  const viewH = rect ? (aspect >= 1 ? Math.round(RECT_VIEW / aspect) : RECT_VIEW) : VIEW;

  /** いまの倍率・比で切り出す枠の幅と高さ（元画像の画素数）。倍率 1 で画像に収まる最大の枠 */
  const cropSize = useCallback(() => {
    const img = imgRef.current;
    if (!img) return { w: 0, h: 0 };
    const fitsByHeight = img.width / img.height > aspect;
    const h = (fitsByHeight ? img.height : img.width / aspect) / scale;
    return { w: h * aspect, h };
  }, [scale, aspect]);

  /** 枠が画像からはみ出さないところまで戻す */
  const clamp = useCallback(
    (c: { x: number; y: number }) => {
      const img = imgRef.current;
      if (!img) return c;
      const { w, h } = cropSize();
      return {
        x: Math.min(Math.max(c.x, w / 2), img.width - w / 2),
        y: Math.min(Math.max(c.y, h / 2), img.height - h / 2),
      };
    },
    [cropSize],
  );

  /** 枠の中身を描く。実際に保存されるのと同じ範囲 */
  const draw = useCallback(
    (target: HTMLCanvasElement, outW: number, outH: number) => {
      const img = imgRef.current;
      const ctx = target.getContext("2d");
      if (!img || !ctx) return;
      const { w, h } = cropSize();
      const c = clamp(center);
      if (rect) {
        // 題字のアイコンは透明のまま（帯の色が透けて見えるように）
        ctx.clearRect(0, 0, outW, outH);
      } else {
        // 透過のある画像でも白地にする（丸く切り抜くので、透けると背景と混ざる）
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, outW, outH);
      }
      ctx.drawImage(img, c.x - w / 2, c.y - h / 2, w, h, 0, 0, outW, outH);
    },
    [center, clamp, cropSize, rect],
  );

  useEffect(() => {
    if (ready && canvasRef.current) draw(canvasRef.current, viewW, viewH);
  }, [ready, draw, viewW, viewH]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const from = dragRef.current;
    if (!from) return;
    // 画面上の移動量を、元画像の画素数に直す
    const k = cropSize().w / viewW;
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
    if (rect) {
      out.width = Math.round(aspect >= 1 ? RECT_SHORT * aspect : RECT_SHORT);
      out.height = Math.round(aspect >= 1 ? RECT_SHORT : RECT_SHORT / aspect);
    } else {
      out.width = AVATAR_SIDE;
      out.height = AVATAR_SIDE;
    }
    draw(out, out.width, out.height);
    if (rect) out.toBlob((b) => b && onDone(b), "image/png");
    else out.toBlob((b) => b && onDone(b), "image/jpeg", 0.85);
  }

  if (failed) return <p className="text-destructive text-sm">{m.preferences.avatarTypeError}</p>;

  const sliderWidth = Math.max(viewW, VIEW) - 80;

  return (
    <div className="space-y-3">
      <div
        className="bg-muted relative overflow-hidden rounded-md border"
        style={{ width: viewW, height: viewH }}
      >
        <canvas
          ref={canvasRef}
          width={viewW}
          height={viewH}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="cursor-grab touch-none active:cursor-grabbing"
        />
        {/* 実際に出るのは丸なので、丸の外を暗くして仕上がりを見せる（長方形のときは枠そのものが仕上がり） */}
        {!rect && (
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
        )}
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="avatar-zoom" className="w-14 text-sm">
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
          style={{ width: sliderWidth }}
        />
      </div>

      {rect && (
        <div className="flex items-center gap-2">
          <label htmlFor="crop-aspect" className="w-14 text-sm">
            {m.preferences.cropAspect}
          </label>
          {/* 比の対数で動かす。1:2 と 2:1 がつまみの真ん中から同じ距離になる */}
          <input
            id="crop-aspect"
            type="range"
            min={Math.log2(ASPECT_MIN)}
            max={Math.log2(ASPECT_MAX)}
            step={0.01}
            value={Math.log2(aspect)}
            onChange={(e) => {
              setAspect(clampAspect(2 ** Number(e.target.value)));
              setCenter((c) => clamp(c));
            }}
            style={{ width: sliderWidth }}
          />
          <span className="text-muted-foreground w-12 text-xs tabular-nums">
            {aspect >= 1 ? `${aspect.toFixed(1)}:1` : `1:${(1 / aspect).toFixed(1)}`}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!ready || saving} onClick={confirm}>
          {m.preferences.avatarApply}
        </Button>
        {extra}
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          {m.common.cancel}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{hint ?? m.preferences.avatarCropHint}</p>
    </div>
  );
}
