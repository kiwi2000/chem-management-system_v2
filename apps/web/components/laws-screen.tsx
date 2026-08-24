"use client";

import { useCallback, useState } from "react";
import { CasLinkSection } from "@/components/cas-link-section";
import { CategoryHeader, type SlideDir } from "@/components/category-header";
import { LawTreeSection, type CategorySelection } from "@/components/law-tree-section";
import { StatutorySubstanceSection } from "@/components/statutory-substance-section";
import { SubstanceHeader } from "@/components/substance-header";
import { useI18n } from "@/lib/i18n-client";
import type { LanguageDto, RegulationCategoryDto, StatutorySubstanceDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 対象CASを見ている法文物質名と、矢印でたどる並び */
interface SubstanceSelection {
  substance: StatutorySubstanceDto;
  siblings: StatutorySubstanceDto[];
}

/**
 * 法規制のマスタ（法令 → 区分 → 分類 → 法文物質名 → 対象CAS）。
 *
 * 一段深く入るたびに、上の段が上へ隠れて見出しだけが残る。
 *  - 何も選んでいない  : 法令の木だけ
 *  - 区分を選んだ      : 区分の見出しと法文物質名。木は上に隠れる
 *  - 法文物質名を選んだ: 法文物質名の見出しと対象CAS。一覧はさらに上に隠れる
 * 隠れたものは、見出しのつまみを押したときだけ降りてくる。スクロールでは降りてこない。
 */
export function LawsScreen({ languages }: { languages: LanguageDto[] }) {
  const { m } = useI18n();

  // 法文物質名の側は、区分の閾値（ひな型）と名前も要るので、行そのものを持つ
  /** 選んだ区分（これから出すもの） */
  const [selection, setSelection] = useState<CategorySelection | null>(null);
  /** いま画面に出ている区分。下の表が読み終わってから追いつく */
  const [shown, setShown] = useState<CategorySelection | null>(null);
  /** 区分を選んでいるあいだ、木を一時的に降ろしているか */
  const [treeOpen, setTreeOpen] = useState(false);
  /** 前後の区分へ移ったときだけ、その向きに滑らせる */
  const [slideDir, setSlideDir] = useState<SlideDir>(null);

  /** 選んだ法文物質名（これから出すもの）と、画面に出ているもの */
  const [subSelection, setSubSelection] = useState<SubstanceSelection | null>(null);
  const [subShown, setSubShown] = useState<SubstanceSelection | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [subSlideDir, setSubSlideDir] = useState<SlideDir>(null);
  /** 対象CASを見ている版。法文物質名を移っても保つので、ここで持つ */
  const [versionId, setVersionId] = useState<string | null>(null);

  const treeVisible = shown === null || treeOpen;
  /** 法文物質名の一覧。対象CASへ降りているあいだは隠れる */
  const listVisible = subShown === null || listOpen;
  /** 次の区分を読んでいる最中。読み終わるまで見出しは前のまま */
  const busy = (selection?.category.id ?? null) !== (shown?.category.id ?? null);
  const subBusy = (subSelection?.substance.id ?? null) !== (subShown?.substance.id ?? null);

  function select(next: CategorySelection | null) {
    setSlideDir(null);
    setSelection(next);
    // 別の区分に移ったら、対象CASの段からは出る
    closeSubstance();
  }

  function closeSubstance() {
    setSubSelection(null);
    setSubShown(null);
    setSubSlideDir(null);
    setListOpen(false);
  }

  /** ［‹ ›］での移動。法令と兄弟はそのままなので、区分だけ差し替える */
  const navigate = useCallback((category: RegulationCategoryDto, dir: "prev" | "next") => {
    setSlideDir(dir);
    setSelection((prev) => (prev ? { ...prev, category } : prev));
    setSubSelection(null);
    setSubShown(null);
    setListOpen(false);
  }, []);

  /** 下の表が新しい区分を出し終えた合図。見出しと木はここで初めて動く */
  function onShown() {
    setShown(selection);
    // 別の区分に移ったのだから、開いていた木は上へ戻す
    if (selection && selection.category.id !== shown?.category.id) setTreeOpen(false);
  }

  /** 法文物質名の行を1回押した。対象CASの段へ降りる */
  const selectSubstance = useCallback(
    (substance: StatutorySubstanceDto, siblings: StatutorySubstanceDto[]) => {
      setSubSlideDir(null);
      setSubSelection({ substance, siblings });
    },
    [],
  );

  /** ［‹ ›］での移動。並びはそのままなので、法文物質名だけ差し替える */
  const navigateSubstance = useCallback(
    (substance: StatutorySubstanceDto, dir: "prev" | "next") => {
      setSubSlideDir(dir);
      setSubSelection((prev) => (prev ? { ...prev, substance } : prev));
    },
    [],
  );

  /** 対象CASを出し終えた合図 */
  function onSubShown() {
    setSubShown(subSelection);
    if (subSelection && subSelection.substance.id !== subShown?.substance.id) setListOpen(false);
  }

  return (
    // 上の余白は木の側に持たせる。木が隠れているとき、見出しがヘッダーの真下に来る
    <div className="w-full px-4 pb-4 lg:px-6 lg:pb-6">
      {/* 法令の木。高さを測らずに開閉できるよう grid の行を 0fr↔1fr で動かす */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-out",
          treeVisible ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        // 隠れているあいだは Tab でも入れないようにする（見えないのに順番が回ってくるのを防ぐ）
        inert={!treeVisible}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-4 pb-6 lg:pt-6">
            <LawTreeSection
              languages={languages}
              selected={selection?.category ?? null}
              onSelect={select}
            />
          </div>
        </div>
      </div>

      {/* 見出しは1つの箱にまとめて貼り付ける。別々に貼ると重なり方が崩れる */}
      {shown && (
        <div className="bg-background sticky top-14 z-20">
          <CategoryHeader
            selection={shown}
            onNavigate={navigate}
            slideDir={slideDir}
            busy={busy}
            treeOpen={treeOpen}
            onToggleTree={() => setTreeOpen((v) => !v)}
          />
          {subShown && (
            <SubstanceHeader
              substance={subShown.substance}
              siblings={subShown.siblings}
              onNavigate={navigateSubstance}
              slideDir={subSlideDir}
              busy={subBusy}
              listOpen={listOpen}
              onToggleList={() => setListOpen((v) => !v)}
            />
          )}
        </div>
      )}

      {/*
        表は読み込みのあいだも置いたままにする（外すと読み直しになる）。
        中身が揃うまでは隠しておき、揃ったところで滑り込ませる。
      */}
      {selection && (
        <div
          className={cn(
            shown ? "overflow-x-clip" : "hidden",
            "grid transition-[grid-template-rows] duration-300 ease-out",
            listVisible ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
          inert={!listVisible}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="pt-3 pb-6">
              <StatutorySubstanceSection
                languages={languages}
                category={selection.category}
                slideDir={slideDir}
                onShown={onShown}
                selectedId={subSelection?.substance.id ?? null}
                onSelect={selectSubstance}
              />
            </div>
          </div>
        </div>
      )}

      {subSelection && (
        <div className={subShown ? "overflow-x-clip pt-3" : "hidden"}>
          <CasLinkSection
            substance={subSelection.substance}
            versionId={versionId}
            onVersionChange={setVersionId}
            slideDir={subSlideDir}
            onShown={onSubShown}
          />
        </div>
      )}

      {!shown && (
        <p className="text-muted-foreground pt-2 text-sm">{m.statutorySubstances.selectCategory}</p>
      )}
    </div>
  );
}
