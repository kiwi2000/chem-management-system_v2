"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { ImeInput } from "@/components/data-table/ime-field";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";
import { SelectAllCheckbox, selectAllState } from "@/components/select-all-checkbox";

/**
 * 開いた小窓の中身（2026-10-30 指示で、選択肢を開いて選ぶ欄をこれに揃えた）。
 * 上から「探す欄」「すべて選択」「選択肢の一覧」の順に並べる。
 *
 * - 探す欄に打つと、その文字を含む選択肢だけが残る。小窓を閉じると空へ戻る
 *   （小窓を閉じるとこの部品ごと消えるので、打った文字は持ち越さない）
 * - 「すべて選択」は**いま見えている選択肢**に効く。見えていない選択肢の選択はそのまま残す
 */
export function OptionChecklist({
  options,
  isChecked,
  onToggle,
  onSelectAll,
  onClearAll,
  size = "xs",
}: {
  options: { value: string; label: string }[];
  isChecked: (value: string) => boolean;
  onToggle: (value: string, checked: boolean) => void;
  /** 見えている選択肢を全部入れる */
  onSelectAll: (shown: string[]) => void;
  /** 見えている選択肢を全部外す */
  onClearAll: (shown: string[]) => void;
  /** 文字の大きさ。表の絞り込みは xs、入力画面は sm */
  size?: "xs" | "sm";
}) {
  const { m } = useI18n();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q === "" ? options : options.filter((o) => o.label.toLowerCase().includes(q));
  const shownValues = shown.map((o) => o.value);
  const text = size === "sm" ? "text-sm" : "text-xs";

  return (
    <div className={text}>
      {/* 探す欄は上に固定し、下の一覧だけを送る */}
      <div className="relative mb-1">
        <ImeInput
          value={query}
          onValueChange={setQuery}
          aria-label={m.table.optionSearch}
          placeholder={m.table.optionSearch}
          className={cn("h-8 pr-7", text)}
        />
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2" />
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground px-1 py-2">{m.table.optionSearchEmpty}</p>
      ) : (
        <>
          <SelectAllCheckbox
            className="mb-1 px-1"
            label={m.table.checkAll}
            state={selectAllState(shownValues.filter(isChecked).length, shown.length)}
            onSelectAll={() => onSelectAll(shownValues)}
            onClearAll={() => onClearAll(shownValues)}
          />
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {shown.map((o) => (
              <label
                key={o.value}
                className="hover:bg-accent flex items-center gap-2 rounded px-1 py-0.5"
              >
                <input
                  type="checkbox"
                  checked={isChecked(o.value)}
                  onChange={(e) => onToggle(o.value, e.target.checked)}
                />
                {o.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
