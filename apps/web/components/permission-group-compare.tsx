"use client";

import { pickName } from "@chem/shared";
import type { GroupChipOption } from "@/components/permission-group-chips";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/**
 * 組織を変えたときの、管理グループの見比べ（2026-11-17 利用者の指示。見た目も利用者が決めた）。
 *
 * 組織を変えると、管理グループは新しい組織の「最初に選ばれる管理グループ」に選び直す（仕様 8-2）。
 * 黙って入れ替えると、外れたことに気づけない（本番で、部署を変えただけのつもりのシステム管理者が何も見られなくなった）。
 *
 * **全部の管理グループを 1 行に 1 つずつ並べ、左に変更前、右に変更後を置く。**
 * 選択されているものは背景にテーマの色、選択されていないものは薄い字。印・枠・注記は付けない（左右を見比べれば分かる）。
 * 変更後は、行を押すと選択と非選択が入れ替わる。保存されるのは変更後。
 * システム管理グループだけは赤で出す（外れる・入るを見落とさないため）
 */
export function PermissionGroupCompare({
  options,
  before,
  after,
  onChange,
  locked,
  disabled,
}: {
  options: GroupChipOption[];
  /** 変更前（見るだけ） */
  before: string[];
  /** 変更後（押して切り替える。保存されるのはこちら） */
  after: string[];
  onChange: (next: string[]) => void;
  /** 外せないもの（自分のシステム管理グループなど） */
  locked?: Set<string>;
  disabled?: boolean;
}) {
  const { m, locale } = useI18n();

  /** 選択・非選択の色。システム管理グループは赤、ほかはテーマの色 */
  const tone = (o: GroupChipOption, on: boolean) =>
    o.isSystemAdmin
      ? on
        ? "bg-red-200 text-red-950 dark:bg-red-900 dark:text-red-50"
        : "text-red-500 dark:text-red-400"
      : on
        ? "bg-primary/20 text-foreground"
        : "text-muted-foreground";
  /** 押せる行にマウスを乗せたときの色 */
  const hover = (o: GroupChipOption, on: boolean) =>
    o.isSystemAdmin
      ? on
        ? "hover:bg-red-300 dark:hover:bg-red-800"
        : "hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-200"
      : on
        ? "hover:bg-primary/30"
        : "hover:bg-primary/10 hover:text-foreground";

  return (
    <div data-slot="group-compare" className="space-y-2">
      <p className="text-muted-foreground text-sm">{m.users.regroupedNotice}</p>
      <table className="w-full max-w-xl table-fixed border-collapse border text-sm">
        <thead>
          <tr className="bg-muted text-muted-foreground border-b text-left text-xs">
            <th className="w-1/2 px-3 py-1.5 font-semibold">{m.users.groupsBefore}</th>
            <th className="w-1/2 border-l px-3 py-1.5 font-semibold">{m.users.groupsAfter}</th>
          </tr>
        </thead>
        <tbody>
          {options.map((o) => {
            const was = before.includes(o.id);
            const is = after.includes(o.id);
            const fixed = disabled || (is && (locked?.has(o.id) ?? false));
            const name = pickName(locale, o.nameJa, o.nameEn);
            return (
              <tr key={o.id} className="border-b last:border-b-0">
                <td
                  data-slot="group-before"
                  data-code={o.code}
                  data-on={was}
                  className={cn("px-3 py-1 leading-5", tone(o, was))}
                >
                  {name}
                </td>
                <td className="border-l p-0">
                  <button
                    type="button"
                    data-slot="group-after"
                    data-code={o.code}
                    data-on={is}
                    aria-pressed={is}
                    disabled={fixed}
                    onClick={() =>
                      onChange(is ? after.filter((g) => g !== o.id) : [...after, o.id])
                    }
                    className={cn(
                      "block w-full px-3 py-1 text-left leading-5",
                      tone(o, is),
                      fixed ? "cursor-not-allowed" : cn("cursor-pointer", hover(o, is)),
                    )}
                  >
                    {name}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
