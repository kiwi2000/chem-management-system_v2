import type { ReactNode } from "react";
import { SpecNav } from "./spec-nav";

/**
 * 仕様書。
 *
 * 開発中の確認用に、仕様と変更点を画面の中から読めるようにしたもの。
 * 本番を作るときに、この画面ごとメニューから外す。
 */
export default function SpecLayout({ children }: { children: ReactNode }) {
  return (
    <div className="w-full p-4 lg:p-6">
      <div className="flex flex-col gap-8 lg:flex-row">
        {/* 目次。狭い画面では本文の上に回り込む */}
        <aside className="lg:w-56 lg:shrink-0">
          <div className="lg:sticky lg:top-20">
            <div className="text-muted-foreground px-3 pb-2 text-xs font-medium">目次</div>
            <SpecNav />
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-8">{children}</div>
      </div>
    </div>
  );
}
