import type { ReactNode } from "react";
import { ManualSearch } from "./manual-search";
import { SpecNav } from "./spec-nav";

/**
 * ユーザーマニュアル。
 *
 * 使いかたを画面の中から読めるようにしたもの。開発中の確認にも使う。
 * 本番を作るときに、この画面ごとメニューから外す。
 */
export default function ManualLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full p-4 lg:p-6">
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* 目次。狭い画面では本文の上に回り込む */}
        <aside className="lg:w-56 lg:shrink-0">
          <div className="space-y-4 lg:sticky lg:top-20">
            <ManualSearch />
            <div>
              <div className="text-muted-foreground px-3 pb-2 text-xs font-medium">目次</div>
              <SpecNav />
            </div>
          </div>
        </aside>

        {/* data-manual-content は検索が本文だけを拾うための目印 */}
        <div data-manual-content className="min-w-0 flex-1 space-y-8">
          {children}
        </div>
      </div>
    </div>
  );
}
