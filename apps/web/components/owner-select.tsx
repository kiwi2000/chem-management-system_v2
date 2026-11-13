"use client";

import { pickName } from "@chem/shared";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n-client";
import type { OwnerChoicesDto } from "@/lib/types";

/**
 * 所属先を 1 つ選ぶ（S31 仕様 7 章）。選べるのは「編集」の印を持つ管理グループだけ。
 * 1 つしか無い人は自動で決まり、選ぶ欄は出さない。2 つ以上ある人・システム管理グループの人は、
 * 何も選ばれていない状態から必ず選ばせる
 */
export function OwnerSelect({
  id,
  choices,
  value,
  onChange,
  exclude,
  disabled,
}: {
  id?: string;
  choices: OwnerChoicesDto | null;
  value: string;
  onChange: (id: string) => void;
  /** 選ばせない所属先（移すときの今の所属先） */
  exclude?: string;
  disabled?: boolean;
}) {
  const { m, locale } = useI18n();
  const auto = choices?.autoPick ?? null;
  // 1 つしか無いときは、それに決める
  useEffect(() => {
    if (auto && value !== auto && auto !== exclude) onChange(auto);
  }, [auto, value, exclude, onChange]);

  if (!choices) return null;
  const items = choices.items.filter((c) => c.id !== exclude);
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{m.owner.noChoices}</p>;
  }
  if (auto && auto !== exclude) {
    const only = items.find((c) => c.id === auto);
    return <p className="text-sm">{only ? pickName(locale, only.nameJa, only.nameEn) : ""}</p>;
  }
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-background h-9 w-full max-w-xs rounded-none border px-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">{m.owner.choose}</option>
      {items.map((c) => (
        <option key={c.id} value={c.id}>
          {pickName(locale, c.nameJa, c.nameEn)}（{c.code}）
        </option>
      ))}
    </select>
  );
}
