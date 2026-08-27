"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { LawTreeSection, type CategorySelection } from "@/components/law-tree-section";
import type { LanguageDto } from "@/lib/types";

/**
 * 法規制のマスタ（法令 → 区分）。
 *
 * **1段につき1画面。**インベントリと同じ形にそろえてある。
 * 区分のコードを押すと法文物質名の一覧へ、そこからさらに対象CASへ移る。
 * 以前は1ページの中で下へ展開していく作りだったが、
 * いまどの段にいるのかが URL からも分かるようにした。
 */
export function LawsScreen({ languages }: { languages: LanguageDto[] }) {
  const router = useRouter();

  /** 区分の行を押したら、その区分の法文物質名へ移る（コードのリンクと同じ行き先） */
  const select = useCallback(
    (next: CategorySelection | null) => {
      if (next) router.push(`/categories/${next.category.id}`);
    },
    [router],
  );

  return (
    <div className="w-full p-4 lg:p-6">
      <LawTreeSection languages={languages} selected={null} onSelect={select} />
    </div>
  );
}
