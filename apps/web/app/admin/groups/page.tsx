"use client";

import { GroupSection } from "@/components/group-section";
import { useI18n } from "@/lib/i18n-client";

/**
 * グループ管理。
 * ニュースグループと所属は使う場面が違うので、1つの表に混ぜず上下に分けて扱う。
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

      <GroupSection
        kind="ORG"
        title={m.groups.kindOrg}
        hint={m.groups.kindOrgHint}
        storageKey="chem.table.groups.org"
      />
    </div>
  );
}
