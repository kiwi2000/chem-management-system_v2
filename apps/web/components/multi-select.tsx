"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useState } from "react";
import { useOutsideClose } from "@/lib/use-outside-close";
import { OptionChecklist } from "@/components/option-checklist";

interface Props {
  id: string;
  /** 選べる値。並び順がそのまま表示順 */
  options: string[];
  /** 選択済みの値。options に無い値（設定から消された値）も表示は残す */
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** 未選択のときにボタンへ出す文言 */
  placeholder: string;
  ariaLabel: string;
}

/**
 * 複数選べるプルダウン。
 * ネイティブの multiple 付き select は Ctrl＋クリックが要って誤操作が多いので、
 * 開いた中にチェックボックスを並べる形にしている。
 */
export function MultiSelect({
  id,
  options,
  values,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // 開きっぱなしで他の入力を隠さないよう、外側のクリックと Esc で閉じる
  const boxRef = useOutsideClose<HTMLDivElement>(open, close);

  // 選択の並びは options の順に揃える（見た目の順＝設定した順）
  function sortByOptions(next: string[]) {
    const rank = new Map(options.map((o, i) => [o, i]));
    return next.sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999));
  }

  function toggle(v: string) {
    onChange(sortByOptions(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]));
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="border-input bg-background flex h-9 w-64 items-center justify-between gap-2 rounded-none border px-3 text-sm disabled:bg-input/50 disabled:cursor-not-allowed"
      >
        <span className={values.length === 0 ? "text-muted-foreground" : undefined}>
          {values.length === 0 ? placeholder : values.join("、")}
        </span>
        <ChevronDown className="size-4 shrink-0" />
      </button>

      {open && (
        <div className="bg-background absolute z-20 mt-1 w-64 rounded-md border p-2 shadow-md">
          {options.length === 0 ? (
            <p className="text-muted-foreground p-1 text-xs">—</p>
          ) : (
            /*
              中身は表の絞り込みの小窓と同じ部品（2026-10-30。探す欄・「すべて選択」・一覧の並びを揃えた）。
              選択肢から消された値（設定で外した用途など）は、全部入れる・外すときも残す
            */
            <OptionChecklist
              size="sm"
              options={options.map((o) => ({ value: o, label: o }))}
              isChecked={(v) => values.includes(v)}
              onToggle={(v) => toggle(v)}
              onSelectAll={(shown) =>
                onChange(sortByOptions([...values, ...shown.filter((v) => !values.includes(v))]))
              }
              onClearAll={(shown) => onChange(values.filter((v) => !shown.includes(v)))}
            />
          )}
        </div>
      )}
    </div>
  );
}
