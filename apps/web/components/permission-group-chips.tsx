"use client";

import { Popover } from "@base-ui/react/popover";
import { pickName } from "@chem/shared";
import { ShieldCheck, X } from "lucide-react";
import { OptionChecklist } from "@/components/option-checklist";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

export interface GroupChipOption {
  id: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  isSystemAdmin: boolean;
}

/**
 * 管理グループを丸いラベルで並べ、「＋ 追加」で選択肢の小窓を開いて足す（S31 画面設計 4 章）。
 * ラベルの ✕ で外す。点線の縁は「組織から最初に選ばれたもの」。
 * **システム管理グループは、濃い紫に盾の印で目立たせる**（2026-11-17 指示。入っている・外れるを見落とさないため）。
 *
 * **小窓は画面のいちばん外側に重ねて開く（Popover）。**欄の下にそのまま置くと、欄が枠（Card）の下の端に近いとき、
 * 枠からはみ出した分が切られて一覧が見えない（2026-11-17、本番で「選択肢が出ない」と言われた）
 */
export function PermissionGroupChips({
  options,
  value,
  onChange,
  defaults,
  locked,
  disabled,
  emptyLabel,
  removed,
  added,
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
  /** 見比べのとき、外れるもの（取り消し線と赤の縁） */
  removed?: Set<string>;
  /** 見比べのとき、加わるもの（緑の縁） */
  added?: Set<string>;
}) {
  const { m, locale } = useI18n();

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
                ? "bg-violet-600 px-3 py-1 text-sm text-white dark:bg-violet-500"
                : "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
              isDefault && "outline-dashed outline-2 outline-offset-1 outline-teal-600",
              (added?.has(o.id) ?? false) && "ring-2 ring-emerald-500 ring-offset-1",
              (removed?.has(o.id) ?? false) &&
                "line-through decoration-2 ring-2 ring-red-500 ring-offset-1",
            )}
          >
            {o.isSystemAdmin && <ShieldCheck className="size-3.5" aria-hidden />}
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
        <Popover.Root>
          <Popover.Trigger className="text-muted-foreground inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs hover:bg-accent">
            {m.common.add}
          </Popover.Trigger>
          <Popover.Portal>
            {/* 下に入りきらなければ上へ開く。外側のクリックと Esc で閉じる */}
            <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
              <Popover.Popup className="bg-popover text-popover-foreground w-72 rounded-none border p-2 shadow-md outline-none">
                <OptionChecklist
                  size="sm"
                  options={options.map((o) => ({
                    value: o.id,
                    label: `${labelOf(o)}（${o.code}）`,
                  }))}
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
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
