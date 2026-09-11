"use client";

import { FoldVertical, UnfoldVertical } from "lucide-react";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { setAllCards, useCardCount } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-client";

/**
 * 画面にある枠（見出し付きのカード）を、まとめて開く／閉じるボタン。
 * 枠が1つも無い画面では出ない（2026-09-11 指示）
 */
export function CardToggleAll() {
  const { m } = useI18n();
  const count = useCardCount();
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        title={m.composition.expandAll}
        onClick={() => setAllCards(true)}
      >
        <UnfoldVertical className="mr-1 size-3.5" />
        {m.composition.expandAll}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        title={m.composition.collapseAll}
        onClick={() => setAllCards(false)}
      >
        <FoldVertical className="mr-1 size-3.5" />
        {m.composition.collapseAll}
      </Button>
    </div>
  );
}

/**
 * 「展開」「格納」を、その画面の見出し（h1）の下に出す（2026-09-11 指示。
 * 上部の帯 → 中身のいちばん上、と置いてきたが、見出しの下がいちばん目に入る）。
 *
 * 画面ごとに置き場所を書かずに済むよう、見出しの直後に入れ物を差し込んで、そこへ描く。
 * 見出しが「見出し＋右側のボタン」の行（flex）に入っているときは、その行の下に置く。
 * 見出しが見つからない画面では、中身のいちばん上に出す
 */
export function CardToggleRow() {
  const count = useCardCount();
  const pathname = usePathname();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [fallback, setFallback] = useState(false);

  useLayoutEffect(() => {
    if (count === 0) {
      setHost(null);
      setFallback(false);
      return;
    }
    const main = document.querySelector("main");
    const h1 = main?.querySelector("h1");
    if (!main || !h1) {
      setHost(null);
      setFallback(true);
      return;
    }
    const parent = h1.parentElement;
    const anchor = parent && parent !== main && parent.classList.contains("flex") ? parent : h1;
    const el = document.createElement("div");
    el.className = "flex flex-wrap items-center gap-2";
    anchor.insertAdjacentElement("afterend", el);
    setHost(el);
    setFallback(false);
    return () => {
      el.remove();
    };
  }, [count, pathname]);

  if (host) return createPortal(<CardToggleAll />, host);
  if (fallback) {
    return (
      <div className="flex justify-end px-4 pt-3 lg:px-6">
        <CardToggleAll />
      </div>
    );
  }
  return null;
}
