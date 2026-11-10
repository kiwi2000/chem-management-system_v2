"use client";

import { pickName } from "@chem/shared";
import { useMemo } from "react";
import { useI18n } from "@/lib/i18n-client";
import { flattenOrgTree } from "@/lib/org-tree";
import type { OrganisationDto } from "@/lib/types";

/**
 * 組織を 1 つ選ぶ（S31）。組織図の上下のまま字下げして並べる。
 * 使わない設定の組織は出さないが、いま選ばれているものだけは残す（消えると外れたように見えるため）
 */
export function OrganisationSelect({
  id,
  organisations,
  value,
  disabled,
  exclude,
  noneLabel,
  onChange,
}: {
  id?: string;
  organisations: OrganisationDto[] | null;
  value: string;
  disabled?: boolean;
  /** 選ばせない組織（上の組織に、自分と自分の下を選ばせないため） */
  exclude?: Set<string>;
  /** 未選択の行の文言 */
  noneLabel: string;
  onChange: (id: string) => void;
}) {
  const { locale } = useI18n();
  const rows = useMemo(
    () =>
      flattenOrgTree(
        (organisations ?? []).filter(
          (o) => (o.activeFlag || o.id === value) && !(exclude?.has(o.id) ?? false),
        ),
      ),
    [organisations, value, exclude],
  );
  return (
    <select
      id={id}
      value={value}
      disabled={disabled || organisations === null}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-background h-9 w-full max-w-md rounded-none border px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">{noneLabel}</option>
      {rows.map(({ org, depth }) => (
        <option key={org.id} value={org.id}>
          {"　".repeat(depth)}
          {pickName(locale, org.nameJa, org.nameEn)}
        </option>
      ))}
    </select>
  );
}
