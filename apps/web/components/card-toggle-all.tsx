"use client";

import { FoldVertical, UnfoldVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setAllCards, useCardCount } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-client";

/**
 * 画面にある枠（見出し付きのカード）を、まとめて開く／閉じるボタン。
 * 上部の帯に置く。枠が1つも無い画面では出ない（2026-09-11 指示）
 */
export function CardToggleAll() {
  const { m } = useI18n();
  const count = useCardCount();
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-current hover:bg-white/15 hover:text-current"
        title={m.composition.expandAll}
        aria-label={m.composition.expandAll}
        onClick={() => setAllCards(true)}
      >
        <UnfoldVertical className="size-4" />
        <span className="hidden lg:inline">{m.composition.expandAll}</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-current hover:bg-white/15 hover:text-current"
        title={m.composition.collapseAll}
        aria-label={m.composition.collapseAll}
        onClick={() => setAllCards(false)}
      >
        <FoldVertical className="size-4" />
        <span className="hidden lg:inline">{m.composition.collapseAll}</span>
      </Button>
    </div>
  );
}
