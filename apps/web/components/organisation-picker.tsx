"use client";

import { kindLabelOf, ORGANISATION_KINDS, pickName, type OrganisationKind } from "@chem/shared";
import { useMemo } from "react";
import { useI18n } from "@/lib/i18n-client";
import type { OrganisationDto } from "@/lib/types";

/**
 * 利用者に割り当てる組織の選択。**種別を問わず何件でも。**
 *
 * 種別ごとに見出しを付けて、チェックで付け外しする。
 * 使わない設定の組織は出さないが、その人に既に割り当たっている場合だけは残す。
 * 消えると「外れている」ように見えて、保存した瞬間に所属が外れてしまうため。
 */
export function OrganisationPicker({
  organisations,
  value,
  disabled,
  onChange,
}: {
  organisations: OrganisationDto[] | null;
  /** 割り当てている組織のid */
  value: string[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const { m, locale } = useI18n();
  const kindNames = useMemo(
    () => ({
      COMPANY: m.organisations.kindCompany,
      DEPARTMENT: m.organisations.kindDepartment,
      PARTNER: m.organisations.kindPartner,
      OTHER: m.organisations.kindOther,
    }),
    [m],
  );

  /*
    種別 → 組織。「そのほか」は呼び名（kindLabel）ごとにさらに分ける。
    組織の一覧と同じ並び（表示順）で出す
  */
  const groups = useMemo(() => {
    const rows = (organisations ?? [])
      .filter((o) => o.activeFlag || value.includes(o.id))
      .sort((a, b) => a.displayOrder - b.displayOrder || a.nameJa.localeCompare(b.nameJa, "ja"));
    const out: { key: string; label: string; items: OrganisationDto[] }[] = [];
    for (const kind of ORGANISATION_KINDS as readonly OrganisationKind[]) {
      for (const o of rows.filter((r) => r.kind === kind)) {
        const label = kindLabelOf(o.kind, o.kindLabel, kindNames);
        let g = out.find((x) => x.label === label && x.key.startsWith(kind));
        if (!g) {
          g = { key: `${kind}:${label}`, label, items: [] };
          out.push(g);
        }
        g.items.push(o);
      }
    }
    return out;
  }, [organisations, value, kindNames]);

  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...value, id] : value.filter((v) => v !== id));

  if (organisations === null) return null;
  if (groups.length === 0) {
    return <p className="text-muted-foreground text-sm">{m.users.noOrganisations}</p>;
  }

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {groups.map((g) => (
        <fieldset key={g.key} className="min-w-40 space-y-1">
          <legend className="text-muted-foreground mb-1 text-xs font-medium">{g.label}</legend>
          {g.items.map((o) => (
            <label
              key={o.id}
              className={
                disabled
                  ? "text-muted-foreground flex items-center gap-2 text-sm"
                  : "flex items-center gap-2 text-sm"
              }
            >
              <input
                type="checkbox"
                checked={value.includes(o.id)}
                disabled={disabled}
                onChange={(e) => toggle(o.id, e.target.checked)}
              />
              {pickName(locale, o.nameJa, o.nameEn)}
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
