"use client";

import { formatThreshold, pickStatutoryName } from "@chem/shared";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { slideClass, type SlideDir } from "@/components/category-header";
import { useI18n } from "@/lib/i18n-client";
import type { StatutorySubstanceDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 選んでいる法文物質名の見出し。区分の見出しのすぐ下に貼り付く。
 *
 * 作りは区分の見出しと同じ。左端のつまみで法文物質名の一覧が降りてきて、
 * 左右の矢印で前後の法文物質名へ移れる。分類はまたがない（一覧に出ているぶんだけ）。
 *
 * 中身の編集はここではできない。一覧の行をダブルクリックして行う。
 */
export function SubstanceHeader({
  substance,
  siblings,
  onNavigate,
  slideDir,
  busy = false,
  listOpen,
  onToggleList,
}: {
  substance: StatutorySubstanceDto;
  /** いま一覧に出ている法文物質名。矢印はこの並びをたどる */
  siblings: StatutorySubstanceDto[];
  onNavigate: (next: StatutorySubstanceDto, dir: "prev" | "next") => void;
  slideDir: SlideDir;
  /** 次の法文物質名を読んでいる最中。読み終わるまで矢印は押せない */
  busy?: boolean;
  listOpen: boolean;
  onToggleList: () => void;
}) {
  const { m, locale } = useI18n();

  const at = siblings.findIndex((s) => s.id === substance.id);
  const prev = at > 0 ? siblings[at - 1]! : null;
  const next = at >= 0 && at < siblings.length - 1 ? siblings[at + 1]! : null;

  // 区分の移動が Alt＋← / → なので、こちらは Alt＋↑ / ↓ にして重ならないようにする
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (busy || !e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowUp" && prev) {
        e.preventDefault();
        onNavigate(prev, "prev");
      } else if (e.key === "ArrowDown" && next) {
        e.preventDefault();
        onNavigate(next, "next");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, busy, onNavigate]);

  const name = (s: StatutorySubstanceDto) =>
    pickStatutoryName(locale, s.nameOriginal, s.nameJa, s.nameEn);

  return (
    <div className="bg-background -mx-4 border-b px-4 lg:-mx-6 lg:px-6">
      {/* つまみ。法文物質名の一覧を出し入れする。区分のつまみと同じ形にそろえる */}
      <div className="flex">
        <button
          type="button"
          onClick={onToggleList}
          aria-expanded={listOpen}
          title={m.casLinks.toggleList}
          aria-label={m.casLinks.toggleList}
          className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground flex h-4 w-16 items-center justify-center rounded-b-md border border-t-0 transition-colors"
        >
          <ChevronDown className={cn("size-3 transition-transform", listOpen && "rotate-180")} />
        </button>
      </div>

      <div className="flex items-center gap-1 overflow-hidden py-1">
        <NavButton
          side="prev"
          target={prev}
          busy={busy}
          label={prev ? name(prev) : m.casLinks.prevSubstance}
          onClick={onNavigate}
        />

        {/* 法文物質名が変わるたびに作り直して、滑り込む動きを出す */}
        <div key={substance.id} className={cn("min-w-0 flex-1", slideClass(slideDir))}>
          <div className="truncate text-center">
            {substance.officialNumber && (
              <span className="text-muted-foreground font-mono text-xs">
                {substance.officialNumber}{" "}
              </span>
            )}
            <span className="text-base font-semibold">{name(substance)}</span>
          </div>
          <div className="flex flex-wrap items-baseline justify-center gap-x-6 text-xs">
            <span>
              <span className="text-muted-foreground">{m.statutorySubstances.code} </span>
              <span className="font-mono">{substance.code}</span>
            </span>
            <span>
              <span className="text-muted-foreground">{m.statutorySubstances.threshold} </span>
              <span className="font-mono">
                {formatThreshold(
                  substance.thresholdLower,
                  substance.lowerBound,
                  substance.thresholdUpper,
                  substance.upperBound,
                )}
              </span>
            </span>
          </div>
        </div>

        <NavButton
          side="next"
          target={next}
          busy={busy}
          label={next ? name(next) : m.casLinks.nextSubstance}
          onClick={onNavigate}
        />
      </div>
    </div>
  );
}

/** 前後の法文物質名へ移るボタン。隣に何があるか見えるよう名前も出す */
function NavButton({
  side,
  target,
  busy,
  label,
  onClick,
}: {
  side: "prev" | "next";
  target: StatutorySubstanceDto | null;
  busy: boolean;
  label: string;
  onClick: (next: StatutorySubstanceDto, dir: "prev" | "next") => void;
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
