"use client";

import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * 色を選ぶ。よく使う色を並べ、そこに無ければ自分で作れる。
 *
 * **並べる色は見分けの付くものだけにする。**近い色ばかりだと、
 * 色が手がかりにならない。自分で作る色は、その責任を選ぶ人に渡す。
 *
 * **色は目印であって、意味を持たせない。**色だけで内容を伝えると、
 * 色が見分けにくい人に伝わらない。どの画面でも、色の隣に必ず文字を置く。
 */
const PALETTE = [
  { hex: "#d32f2f", nameJa: "赤", nameEn: "Red" },
  { hex: "#e64a19", nameJa: "朱色", nameEn: "Deep orange" },
  { hex: "#f57c00", nameJa: "橙", nameEn: "Orange" },
  { hex: "#f9a825", nameJa: "山吹", nameEn: "Amber" },
  { hex: "#689f38", nameJa: "黄緑", nameEn: "Light green" },
  { hex: "#2e7d32", nameJa: "緑", nameEn: "Green" },
  { hex: "#00897b", nameJa: "青緑", nameEn: "Teal" },
  { hex: "#0288d1", nameJa: "水色", nameEn: "Light blue" },
  { hex: "#1565c0", nameJa: "青", nameEn: "Blue" },
  { hex: "#5e35b1", nameJa: "菫色", nameEn: "Deep purple" },
  { hex: "#8e24aa", nameJa: "紫", nameEn: "Purple" },
  { hex: "#c2185b", nameJa: "赤紫", nameEn: "Pink" },
  { hex: "#6d4c41", nameJa: "茶", nameEn: "Brown" },
  { hex: "#546e7a", nameJa: "青灰", nameEn: "Blue grey" },
  { hex: "#424242", nameJa: "灰", nameEn: "Grey" },
];

export const SOURCE_PALETTE = PALETTE.map((p) => p.hex);

/** 色の見本。表の中に置く小さな丸 */
export function ColorDot({ color, className }: { color: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3.5 shrink-0 rounded-full border",
        // 色を決めていないときは、枠だけの丸にする。何も出さないと欄が空に見える
        color ? "border-transparent" : "border-muted-foreground/40 border-dashed",
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

/**
 * 色を選ぶボタン。押すと見本が並び、選ぶと閉じる。
 *
 * **常に開いていない。**表の中に15個の色を並べると、行の高さが跳ね上がる。
 */
export function ColorPicker({
  value,
  onChange,
  disabled,
  label,
  clearLabel,
  customLabel,
  locale,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  disabled?: boolean;
  /** ボタンの読み上げ用の名前 */
  label: string;
  /** 「決めていません」を選ぶときの文言 */
  clearLabel: string;
  /** 自分で色を作るときの文言 */
  customLabel: string;
  locale: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  /*
    出す位置。**表の外に描く。**表は横スクロールの箱なので、
    中に置くと下や右がはみ出したぶんが切り落とされて見えない
  */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  /** 自分で作った色。押して決めるまで送らない（下の注記を見ること） */
  const [custom, setCustom] = useState(value ?? "#1565c0");
  // 外で色が変わったら合わせる（同じ種別の別の行から変えたときなど）
  useEffect(() => {
    if (value) setCustom(value);
  }, [value]);

  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const width = 168;
    const height = 190;
    // 画面の右や下からはみ出すときは、内側へ寄せる
    setAt({
      top: r.bottom + 4 + height > window.innerHeight ? r.top - height - 4 : r.bottom + 4,
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    });
  }, [open]);

  /*
    外を押したら閉じる。表の中に置くので、開いたままだと
    下の行が隠れて押せなくなる
  */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || panel.current?.contains(t)) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const nameOf = (p: (typeof PALETTE)[number]) => (locale === "en" ? p.nameEn : p.nameJa);

  return (
    <div ref={box} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "border-input flex h-7 items-center gap-1 rounded-sm border px-1.5",
          disabled ? "opacity-50" : "hover:bg-muted",
        )}
      >
        <ColorDot color={value} />
      </button>

      {open &&
        at &&
        createPortal(
          <div
            ref={panel}
            style={{ top: at.top, left: at.left }}
            className="bg-popover fixed z-50 w-[10.5rem] rounded-md border p-2 shadow-md"
            role="dialog"
            aria-label={label}
          >
            <div className="grid grid-cols-5 gap-1">
              {PALETTE.map((p) => (
                <button
                  key={p.hex}
                  type="button"
                  title={nameOf(p)}
                  aria-label={nameOf(p)}
                  aria-pressed={value === p.hex}
                  onClick={() => {
                    onChange(p.hex);
                    setOpen(false);
                  }}
                  className="flex size-6 items-center justify-center rounded-full"
                  style={{ backgroundColor: p.hex }}
                >
                  {value === p.hex && <Check className="size-3.5 text-white" />}
                </button>
              ))}
            </div>
            {/*
            並びに無い色を作る。色の輪は端末に任せる（`input type="color"`）。

            **保存するのは隣のボタンを押したときだけ。**輪を触るたびに送ると
            書き込みが何十回も走り、焦点が外れたときに送ると、
            輪を開いて何も選ばずに閉じただけで色が付いてしまう
          */}
            <div className="mt-2 flex items-center gap-1.5 border-t pt-2">
              <input
                type="color"
                aria-label={customLabel}
                value={custom}
                disabled={disabled}
                onChange={(e) => setCustom(e.target.value)}
                className="border-input size-6 shrink-0 cursor-pointer rounded-full border bg-transparent p-0"
              />
              <button
                type="button"
                onClick={() => {
                  onChange(custom);
                  setOpen(false);
                }}
                className="hover:bg-muted flex-1 rounded-sm px-1 py-1 text-left text-xs"
              >
                {customLabel}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="hover:bg-muted mt-1 flex w-full items-center gap-1.5 rounded-sm px-1 py-1 text-xs"
            >
              <ColorDot color={null} />
              {clearLabel}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
