"use client";

import { FoldVertical, UnfoldVertical } from "lucide-react";
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
 * 画面の中身のいちばん上、右寄せに置く行。開け閉めできる枠のある画面にだけ出る
 * （上部の帯に置いていたときは目に入らなかった。2026-09-11 指示）
 */
export function CardToggleRow() {
  const count = useCardCount();
  if (count === 0) return null;
  return (
    <div className="flex justify-end px-4 pt-3 lg:px-6">
      <CardToggleAll />
    </div>
  );
}
