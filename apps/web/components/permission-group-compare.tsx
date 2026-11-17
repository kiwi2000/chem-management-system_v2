"use client";

import { pickName } from "@chem/shared";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { PermissionGroupChips, type GroupChipOption } from "@/components/permission-group-chips";
import { useI18n } from "@/lib/i18n-client";

/**
 * 組織を変えたときの、管理グループの見比べ（2026-11-17 利用者の指示）。
 *
 * 組織を変えると、管理グループは新しい組織の「最初に選ばれる管理グループ」に選び直す（仕様 8-2）。
 * 黙って入れ替えると、外れたことに気づけない（本番で、部署を変えただけのつもりのシステム管理者が何も見られなくなった）。
 * **変更前と変更後を並べて見せ、変更後はその場で直せる。**外れるもの・加わるものは言葉でも出す。
 * システム管理グループだけを特別に聞くことはしない。ラベルと言葉の両方で目立たせる
 */
export function PermissionGroupCompare({
  options,
  before,
  after,
  onChange,
  defaults,
  locked,
  disabled,
}: {
  options: GroupChipOption[];
  /** 変更前（見るだけ） */
  before: string[];
  /** 変更後（直せる。保存されるのはこちら） */
  after: string[];
  onChange: (next: string[]) => void;
  defaults?: Set<string>;
  locked?: Set<string>;
  disabled?: boolean;
}) {
  const { m, locale } = useI18n();
  const removed = new Set(before.filter((g) => !after.includes(g)));
  const added = new Set(after.filter((g) => !before.includes(g)));
  // 選択肢の並び（システム管理グループが先頭）で出す
  const names = (ids: Set<string>) =>
    options
      .filter((o) => ids.has(o.id))
      .map((o, i) => (
        <span key={o.id}>
          {i > 0 && "、"}
          {o.isSystemAdmin ? (
            <strong className="inline-flex items-center gap-0.5 font-bold text-violet-700 dark:text-violet-300">
              <ShieldCheck className="size-3.5" aria-hidden />
              {pickName(locale, o.nameJa, o.nameEn)}
            </strong>
          ) : (
            pickName(locale, o.nameJa, o.nameEn)
          )}
        </span>
      ));

  return (
    <div
      data-slot="group-compare"
      className="space-y-3 border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30"
    >
      <p className="text-sm text-amber-800 dark:text-amber-300">{m.users.regroupedNotice}</p>
      <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div data-slot="group-before" className="space-y-1.5">
          <div className="text-muted-foreground text-xs font-semibold">{m.users.groupsBefore}</div>
          <PermissionGroupChips
            options={options}
            value={before}
            onChange={() => {}}
            disabled
            removed={removed}
            emptyLabel={m.users.permissionGroupsNone}
          />
        </div>
        <ArrowRight className="text-muted-foreground mt-6 hidden size-4 sm:block" aria-hidden />
        <div data-slot="group-after" className="space-y-1.5">
          <div className="text-xs font-semibold">{m.users.groupsAfter}</div>
          <PermissionGroupChips
            options={options}
            value={after}
            onChange={onChange}
            defaults={defaults}
            locked={locked}
            disabled={disabled}
            added={added}
            emptyLabel={m.users.permissionGroupsNone}
          />
        </div>
      </div>
      <div data-slot="group-diff" className="space-y-0.5 text-sm">
        {removed.size === 0 && added.size === 0 && (
          <p className="text-muted-foreground">{m.users.groupsSame}</p>
        )}
        {removed.size > 0 && (
          <p>
            <span className="font-semibold text-red-700 dark:text-red-400">
              {m.users.groupsRemoved}:{" "}
            </span>
            {names(removed)}
          </p>
        )}
        {added.size > 0 && (
          <p>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {m.users.groupsAdded}:{" "}
            </span>
            {names(added)}
          </p>
        )}
      </div>
    </div>
  );
}
