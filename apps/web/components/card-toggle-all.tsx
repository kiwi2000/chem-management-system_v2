"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { setAllCards, useCardsState } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-client";

/**
 * 画面にある枠（見出し付きのカード）を、まとめて開く／閉じるボタン。
 * **状態で出し分ける**（2026-09-12 指示）。全部閉じていれば「＞ 開」だけ、全部開いていれば「∨ 閉」だけ、
 * 一部だけ開いていれば両方。枠が1つも無い画面では出ない
 */
export function CardToggleAll() {
  const { m } = useI18n();
  const { count, allOpen, anyOpen } = useCardsState();
  if (count === 0) return null;
  return (
    <>
      {!allOpen && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          title={m.composition.expandAllHint}
          onClick={() => setAllCards(true)}
        >
          <ChevronRight className="mr-1 size-3.5" />
          {m.composition.expandAll}
        </Button>
      )}
      {anyOpen && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          title={m.composition.collapseAllHint}
          onClick={() => setAllCards(false)}
        >
          <ChevronDown className="mr-1 size-3.5" />
          {m.composition.collapseAll}
        </Button>
      )}
    </>
  );
}

/**
 * 「開」「閉」を、その画面の見出し（h1）の**右**に、少し間を空けて出す（2026-09-12 指示。
 * 上部の帯 → 中身のいちばん上 → 見出しの下、と置いてきたが、見出しの横がいちばん目に入る）。
 *
 * 画面ごとに置き場所を書かずに済むよう、見出しの直後に入れ物を差し込んで、そこへ描く。
 * 見出しが「見出し＋右側のボタン」の行（flex）に入っていれば、その行の中の見出しの隣に置き、
 * 右側のボタンは右に寄せたままにする。見出しだけの画面では、見出しを横並びにして隣に置く。
 * 見出しが見つからない画面では、中身のいちばん上に出す
 */
export function CardToggleRow() {
  const { count } = useCardsState();
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
    const inRow = parent !== null && parent !== main && parent.classList.contains("flex");
    const el = document.createElement("div");
    if (inRow) {
      // 見出しの隣。mr-auto で右側のボタン群を右へ押しやる
      el.className = "ml-1 mr-auto flex flex-wrap items-center gap-2";
    } else {
      // 見出しだけの画面。見出しを横並びにして、その右に置く
      h1.style.display = "inline-block";
      h1.style.verticalAlign = "middle";
      el.className = "ml-4 inline-flex items-center gap-2 align-middle";
    }
    h1.insertAdjacentElement("afterend", el);
    setHost(el);
    setFallback(false);
    return () => {
      el.remove();
      if (!inRow) {
        h1.style.display = "";
        h1.style.verticalAlign = "";
      }
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
