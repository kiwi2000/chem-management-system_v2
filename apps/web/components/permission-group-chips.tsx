"use client";

import { pickName } from "@chem/shared";
import { X } from "lucide-react";
import { useCallback, useState } from "react";
import { OptionChecklist } from "@/components/option-checklist";
import { useI18n } from "@/lib/i18n-client";
import { useOutsideClose } from "@/lib/use-outside-close";
import { cn } from "@/lib/utils";

export interface GroupChipOption {
  id: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  isSystemAdmin: boolean;
}

/**
 * 管理グループを丸い札で並べ、「＋ 追加」で選択肢の小窓を開いて足す（S31 画面設計 4 章）。
 * 札の ✕ で外す。点線の縁は「組織から最初に選ばれたもの」、紫はシステム管理グループ
 */
export function PermissionGroupChips({
  options,
  value,
  onChange,
  defaults,
  locked,
  disabled,
  emptyLabel,
}: {
  options: GroupChipOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** 組織から最初に選ばれたもの（点線の縁で見分ける） */
  defaults?: Set<string>;
  /** 外せないもの（自分のシステム管理グループなど） */
  locked?: Set<string>;
  disabled?: boolean;
  /** 1 つも無いときの文言 */
  emptyLabel: string;
}) {
  const { m, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const boxRef = useOutsideClose<HTMLDivElement>(open, close);

  // 選択肢に無い id（消えた管理グループ）は出さない。並びは選択肢の並び（システム管理グループが先頭、あとはコード順）
  const ordered = options.filter((o) => value.includes(o.id));
  const labelOf = (o: GroupChipOption) => pickName(locale, o.nameJa, o.nameEn);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ordered.length === 0 && <span className="text-muted-foreground text-sm">{emptyLabel}</span>}
      {ordered.map((o) => {
        const isDefault = defaults?.has(o.id) ?? false;
        const isLocked = locked?.has(o.id) ?? false;
        return (
          <span
            key={o.id}
            title={o.code}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
              o.isSystemAdmin
                ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
                : "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
              isDefault && "outline-dashed outline-2 outline-offset-1 outline-teal-600",
            )}
          >
            {labelOf(o)}
            {!disabled && !isLocked && (
              <button
                type="button"
                aria-label={`${labelOf(o)} ${m.common.remove}`}
                onClick={() => onChange(value.filter((v) => v !== o.id))}
                className="opacity-60 hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (
        <div ref={boxRef} className="relative">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="text-muted-foreground inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs hover:bg-accent"
          >
            {m.common.add}
          </button>
          {open && (
            <div className="bg-popover absolute z-20 mt-1 w-72 rounded-none border p-2 shadow-md">
              <OptionChecklist
                size="sm"
                options={options.map((o) => ({ value: o.id, label: `${labelOf(o)}（${o.code}）` }))}
                isChecked={(v) => value.includes(v)}
                onToggle={(v, checked) => {
                  if (!checked && locked?.has(v)) return;
                  onChange(checked ? [...value, v] : value.filter((x) => x !== v));
                }}
                onSelectAll={(shown) => onChange([...new Set([...value, ...shown])])}
                onClearAll={(shown) =>
                  onChange(value.filter((v) => !shown.includes(v) || (locked?.has(v) ?? false)))
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
