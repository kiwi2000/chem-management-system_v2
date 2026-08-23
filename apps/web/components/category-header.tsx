"use client";

import { formatThreshold, pickStatutoryName } from "@chem/shared";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n-client";
import type { CategorySelection } from "@/components/law-tree-section";
import type { RegulationCategoryDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 前後の区分へ移ったとき、どちら向きに滑り込ませるか */
export type SlideDir = "prev" | "next" | null;

/**
 * 区分が入れ替わったことを目で追えるようにする。
 * 木から選び直したときは向きが無いので、そっと現れるだけにする。
 *
 * 距離（96px）と時間（700ms）は、横に動いたと分かる程度まで大きく取ってある。
 * はみ出すぶんは、動かす側の親で切り取る（overflow-hidden / overflow-x-clip）。
 */
export function slideClass(dir: SlideDir) {
  return cn(
    "animate-in fade-in animation-duration-700 ease-out",
    dir === "next" && "slide-in-from-right-24",
    dir === "prev" && "slide-in-from-left-24",
  );
}

/**
 * 選んでいる区分の見出し。画面の上に貼り付いたまま動かない。
 *
 * 左端の小さなつまみを押すと法令の木が降りてくる。スクロールでは降りてこない。
 * 左右の矢印で前後の区分へ移れるが、法令はまたがない（端では灰色になる）。
 * 区分の編集はここではできない。木の行をダブルクリックして行う。
 */
export function CategoryHeader({
  selection,
  onNavigate,
  slideDir,
  busy = false,
  treeOpen,
  onToggleTree,
}: {
  selection: CategorySelection;
  onNavigate: (category: RegulationCategoryDto, dir: "prev" | "next") => void;
  slideDir: SlideDir;
  /** 次の区分を読んでいる最中。読み終わるまで矢印は押せない */
  busy?: boolean;
  treeOpen: boolean;
  onToggleTree: () => void;
}) {
  const { m, locale } = useI18n();
  const { law, category, siblings } = selection;

  const at = siblings.findIndex((c) => c.id === category.id);
  const prev = at > 0 ? siblings[at - 1]! : null;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1]! : null;

  // 表の中の移動と衝突しないよう、単独の矢印キーではなく Alt と組み合わせる
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // 読み込みが終わるまで次の移動を受けない。連打で行き先が飛ぶのを防ぐ
      if (busy || !e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft" && prev) {
        e.preventDefault();
        onNavigate(prev, "prev");
      } else if (e.key === "ArrowRight" && next) {
        e.preventDefault();
        onNavigate(next, "next");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, busy, onNavigate]);

  const name = (c: RegulationCategoryDto) =>
    pickStatutoryName(locale, c.nameOriginal, c.nameJa, c.nameEn);

  return (
    // 上のヘッダー（h-14）のすぐ下に貼り付く。左右の余白いっぱいまで下地を敷く
    <div className="bg-background sticky top-14 z-20 -mx-4 border-b px-4 lg:-mx-6 lg:px-6">
      {/* つまみ。法令の木を出し入れするためだけのもの。表の左端に揃える */}
      <div className="flex">
        <button
          type="button"
          onClick={onToggleTree}
          aria-expanded={treeOpen}
          title={m.regulationCategories.toggleTree}
          aria-label={m.regulationCategories.toggleTree}
          className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground flex h-4 w-16 items-center justify-center rounded-b-md border border-t-0 transition-colors"
        >
          <ChevronDown className={cn("size-3 transition-transform", treeOpen && "rotate-180")} />
        </button>
      </div>

      <div className="flex items-center gap-1 overflow-hidden py-1">
        <NavButton
          side="prev"
          target={prev}
          busy={busy}
          label={prev ? name(prev) : m.regulationCategories.prevCategory}
          onClick={onNavigate}
        />

        {/* 区分が変わるたびに作り直して、滑り込む動きを出す */}
        <div key={category.id} className={cn("min-w-0 flex-1", slideClass(slideDir))}>
          <div className="truncate text-center">
            <span className="text-muted-foreground text-xs">
              {pickStatutoryName(locale, law.nameOriginal, law.nameJa, law.nameEn)} ›{" "}
            </span>
            <span className="text-base font-semibold">{name(category)}</span>
            <span className="text-muted-foreground ml-2 text-xs">
              {m.common.totalCount(category.substanceCount)}
            </span>
          </div>
          {/* 区分名の真下に横並び。折りたためる詳細を持つより1行ぶん浅い */}
          <div className="flex flex-wrap items-baseline justify-center gap-x-6 text-xs">
            <span>
              <span className="text-muted-foreground">{m.regulationCategories.code} </span>
              <span className="font-mono">{category.code}</span>
            </span>
            <span>
              <span className="text-muted-foreground">{m.regulationCategories.threshold} </span>
              <span className="font-mono">
                {formatThreshold(
                  category.thresholdLower,
                  category.lowerBound,
                  category.thresholdUpper,
                  category.upperBound,
                )}
              </span>
            </span>
          </div>
        </div>

        <NavButton
          side="next"
          target={next}
          busy={busy}
          label={next ? name(next) : m.regulationCategories.nextCategory}
          onClick={onNavigate}
        />
      </div>
    </div>
  );
}

/** 前後の区分へ移るボタン。隣に何があるか見えるよう名前も出す（狭い画面では矢印だけ） */
function NavButton({
  side,
  target,
  busy,
  label,
  onClick,
}: {
  side: "prev" | "next";
  target: RegulationCategoryDto | null;
  /** 読み込み中。隣の名前は見せたまま押せなくする */
  busy: boolean;
  label: string;
  onClick: (category: RegulationCategoryDto, dir: "prev" | "next") => void;
}) {
  const Icon = side === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      disabled={!target || busy}
      title={label}
      aria-label={label}
      onClick={() => target && onClick(target, side)}
      className={cn(
        "text-muted-foreground flex max-w-[9rem] shrink-0 items-center gap-0.5 rounded px-1 py-1 text-xs",
        "enabled:hover:bg-accent enabled:hover:text-foreground transition-colors",
        "disabled:opacity-30",
        side === "next" && "flex-row-reverse",
      )}
    >
      <Icon className="size-4 shrink-0" />
      {target && <span className="hidden truncate sm:inline">{label}</span>}
    </button>
  );
}
