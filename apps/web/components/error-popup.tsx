"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 失敗の知らせを、画面の上に浮かべて出す。**押すと消える**（2026-09-22 指示）。
 * 枠の中に出すと次の操作まで残り続けて邪魔になるので、
 * 「なぜできなかったか」を一度読めば済む知らせ（公開の取り消しなど）はこちらで出す
 */
export function ErrorPopup({ message, onClose }: { message: string | null; onClose: () => void }) {
  // createPortal はブラウザでしか使えないので、載ってから出す
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !message) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      <button
        type="button"
        role="alert"
        onClick={onClose}
        className="bg-card text-destructive border-destructive/40 pointer-events-auto flex max-w-2xl cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm shadow-lg"
      >
        <span>{message}</span>
        <X className="mt-0.5 size-4 shrink-0" aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
