"use client";

import { useCallback, useState } from "react";
import { CategoryHeader, type SlideDir } from "@/components/category-header";
import { LawTreeSection, type CategorySelection } from "@/components/law-tree-section";
import { StatutorySubstanceSection } from "@/components/statutory-substance-section";
import { useI18n } from "@/lib/i18n-client";
import type { LanguageDto, RegulationCategoryDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 法規制のマスタ（法令 → 区分 → 分類 → 法文物質名）。
 *
 * 画面の状態は2つだけ。
 *  - 区分を選んでいない: 法令の木だけ
 *  - 区分を選んでいる  : 区分の見出し（上に固定）と法文物質名。木は上に隠れる
 * 隠れた木は、見出しのつまみを押したときだけ降りてくる。スクロールでは降りてこない。
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

  const treeVisible = shown === null || treeOpen;
  /** 次の区分を読んでいる最中。読み終わるまで見出しは前のまま */
  const busy = (selection?.category.id ?? null) !== (shown?.category.id ?? null);

  function select(next: CategorySelection | null) {
    setSlideDir(null);
    setSelection(next);
  }

  /** ［‹ ›］での移動。法令と兄弟はそのままなので、区分だけ差し替える */
  const navigate = useCallback((category: RegulationCategoryDto, dir: "prev" | "next") => {
    setSlideDir(dir);
    setSelection((prev) => (prev ? { ...prev, category } : prev));
  }, []);

  /** 下の表が新しい区分を出し終えた合図。見出しと木はここで初めて動く */
  function onShown() {
    setShown(selection);
    // 別の区分に移ったのだから、開いていた木は上へ戻す
    if (selection && selection.category.id !== shown?.category.id) setTreeOpen(false);
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

      {shown && (
        <CategoryHeader
          selection={shown}
          onNavigate={navigate}
          slideDir={slideDir}
          busy={busy}
          treeOpen={treeOpen}
          onToggleTree={() => setTreeOpen((v) => !v)}
        />
      )}
      {/*
        表は読み込みのあいだも置いたままにする（外すと読み直しになる）。
        中身が揃うまでは隠しておき、揃ったところで滑り込ませる。
      */}
      {selection && (
        // 滑っているあいだ横に飛び出すぶんを切る（横スクロールバーが出ないように）
        <div className={shown ? "overflow-x-clip pt-3" : "hidden"}>
          <StatutorySubstanceSection
            languages={languages}
            category={selection.category}
            slideDir={slideDir}
            onShown={onShown}
          />
        </div>
      )}
      {!shown && (
        <p className="text-muted-foreground pt-2 text-sm">{m.statutorySubstances.selectCategory}</p>
      )}
    </div>
  );
}
