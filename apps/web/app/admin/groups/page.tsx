"use client";

import { GroupSection } from "@/components/group-section";
import { useI18n } from "@/lib/i18n-client";

/**
 * グループ管理。
 *
 * **いまはお知らせの分類だけ。**
 * 所属（部署）はグループではなく組織で持つようになった（会社・取引先と同じ表）
 */
export default function GroupsPage() {
  const { m } = useI18n();

  return (
    <div className="w-full space-y-8 p-4 lg:p-6">
      <div>
        <p className="text-muted-foreground text-sm">{m.groups.description}</p>
      </div>

      <GroupSection
        kind="NEWS"
        title={m.groups.kindNews}
        hint={m.groups.kindNewsHint}
        storageKey="chem.table.groups.news"
      />
    </div>
  );
}
