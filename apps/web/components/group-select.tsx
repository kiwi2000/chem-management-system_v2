"use client";

import { pickName, type GroupKind, type Locale } from "@chem/shared";
import type { GroupDto } from "@/lib/types";

/**
 * グループの選択（1人1つ）。
 * 使わない設定のグループは選べないが、その人に既に割り当たっている場合だけは残す。
 * 消えると「何も選んでいない」ように見えて、保存した瞬間に所属が外れてしまうため。
 */
export function GroupSelect({
  id,
  kind,
  groups,
  value,
  locale,
  noneLabel,
  disabled,
  onChange,
}: {
  id: string;
  kind: GroupKind;
  groups: GroupDto[] | null;
  value: string;
  locale: Locale;
  noneLabel: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const options = (groups ?? []).filter((g) => g.kind === kind && (g.activeFlag || g.id === value));

  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-background h-9 max-w-xs rounded-md border px-2 text-sm"
    >
      <option value="">{noneLabel}</option>
      {options.map((g) => (
        <option key={g.id} value={g.id}>
          {pickName(locale, g.nameJa, g.nameEn)}
        </option>
      ))}
    </select>
  );
}
