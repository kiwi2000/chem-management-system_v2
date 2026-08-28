"use client";

import { useCallback } from "react";
import { LawTreeSection, type CategorySelection } from "@/components/law-tree-section";
import type { LanguageDto } from "@/lib/types";

/**
 * 法規制のマスタ（法律 → 区分）。
 *
 * **1段につき1画面。**インベントリと同じ形にそろえてある。
 * 区分のコードを押すと法文物質名の一覧へ、そこからさらに対象CASへ移る。
 * 以前は1ページの中で下へ展開していく作りだったが、
 * いまどの段にいるのかが URL からも分かるようにした。
 */
export function LawsScreen({ languages }: { languages: LanguageDto[] }) {
  /*
    **行そのものを押しても移らない。**移るのはコードのリンクから。
    ほかの一覧と揃えてある（行を押す＝選ぶ・下に開く）。
    法律の行を押すと、その法律の区分が下に出る（`LawTreeSection` の中で持つ）
  */
  const select = useCallback((_next: CategorySelection | null) => {}, []);

  return (
    <div className="w-full p-4 lg:p-6">
      <LawTreeSection languages={languages} selected={null} onSelect={select} />
    </div>
  );
}
