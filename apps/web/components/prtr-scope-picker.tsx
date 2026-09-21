"use client";

import { expandPermissions, pickName, type Permission } from "@chem/shared";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ListResponse, PrtrGroupDto, PrtrSiteDto } from "@/lib/types";

/** 利用者の画面で持つ担当。空文字は「なし」 */
export interface PrtrScopeValue {
  siteId: string;
  groupId: string;
}

export const EMPTY_PRTR_SCOPE: PrtrScopeValue = { siteId: "", groupId: "" };

/**
 * PRTR の担当（S22-1）。工場かグループのどちらか 1 つ。
 *
 * **権限に合わせて出す欄を変える。**グループ担当ならグループ、工場担当なら工場。
 * 管理者は全グループを見られるので何も選ばせない。PRTR の権限が無ければ選ばせない
 * （権限は「できること」、担当は「どこまで」）
 */
export function PrtrScopePicker({
  permissions,
  value,
  disabled,
  onChange,
}: {
  permissions: Permission[];
  value: PrtrScopeValue;
  disabled?: boolean;
  onChange: (v: PrtrScopeValue) => void;
}) {
  const { m, locale } = useI18n();
  const granted = expandPermissions(permissions);
  const isAdmin = granted.includes("PRTR_ADMIN");
  const needsGroup = !isAdmin && granted.includes("PRTR_GROUP");
  const needsSite = !isAdmin && !needsGroup && granted.includes("PRTR_SITE");

  const [sites, setSites] = useState<PrtrSiteDto[] | null>(null);
  const [groups, setGroups] = useState<PrtrGroupDto[] | null>(null);

  // 管理者が開く画面なので、工場とグループは全部引ける
  useEffect(() => {
    void (async () => {
      const [s, g] = await Promise.all([
        fetch("/api/prtr/sites?size=500").catch(() => null),
        fetch("/api/prtr/groups?size=500").catch(() => null),
      ]);
      if (s?.ok) setSites(((await s.json()) as ListResponse<PrtrSiteDto>).items);
      else if (s) redirectIfUnauthorized(s);
      if (g?.ok) setGroups(((await g.json()) as ListResponse<PrtrGroupDto>).items);
    })();
  }, []);

  const selectClass = "border-input bg-background h-9 max-w-xs rounded-none border px-2 text-sm";

  return (
    <div className="space-y-2">
      <Label htmlFor="prtrScope">{m.users.prtrScope}</Label>
      {needsGroup && (
        <select
          id="prtrScope"
          value={value.groupId}
          disabled={disabled}
          onChange={(e) => onChange({ siteId: "", groupId: e.target.value })}
          className={selectClass}
        >
          <option value="">{m.users.prtrScopeNone}</option>
          {(groups ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {m.users.prtrScopeGroup}: {g.code} {pickName(locale, g.nameJa, g.nameEn)}
            </option>
          ))}
        </select>
      )}
      {needsSite && (
        <select
          id="prtrScope"
          value={value.siteId}
          disabled={disabled}
          onChange={(e) => onChange({ siteId: e.target.value, groupId: "" })}
          className={selectClass}
        >
          <option value="">{m.users.prtrScopeNone}</option>
          {(sites ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {m.users.prtrScopeSite}: {s.code} {pickName(locale, s.nameJa, s.nameEn)}（
              {pickName(locale, s.groupNameJa, s.groupNameEn)}）
            </option>
          ))}
        </select>
      )}
      <p className="text-muted-foreground text-xs">
        {isAdmin
          ? m.users.prtrScopeAdmin
          : needsGroup || needsSite
            ? m.users.prtrScopeHint
            : m.users.prtrScopeDisabled}
      </p>
    </div>
  );
}
