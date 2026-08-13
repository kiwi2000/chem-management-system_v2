"use client";

import {
  PERMISSION_GROUPS,
  PERMISSION_PRESETS,
  dependentsOf,
  expandPermissions,
  type Messages,
  type Permission,
} from "@chem/shared";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";

interface Props {
  value: Permission[];
  onChange: (next: Permission[]) => void;
  disabled?: boolean;
  /** 管理権限を外せない理由（締め出し防止）。指定すると ADMIN のチェックが固定される */
  adminLockedReason?: string | null;
}

/**
 * 権限のチェックボックス群。
 * 入れると含意する権限（編集→閲覧 など）も自動で入り、
 * 外すとその権限を必要としている権限も自動で外れる。保存前に迷わないようにするため。
 */
export function PermissionPicker({ value, onChange, disabled, adminLockedReason }: Props) {
  const { m } = useI18n();
  // 補足説明は一部の権限にしか無い
  const hints = m.permissionHints as Partial<Record<Permission, string>>;

  function toggle(p: Permission, checked: boolean) {
    if (checked) {
      onChange(expandPermissions([...value, p]));
      return;
    }
    // 外すときは、その権限を前提にしている権限（間接的なものも）を一緒に外す
    const drop = new Set<Permission>([p, ...dependentsOf(p)]);
    onChange(expandPermissions(value.filter((x) => !drop.has(x))));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">{m.permissionPresets.label}</span>
        {PERMISSION_PRESETS.map((preset) => (
          <Button
            key={preset.key}
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onChange(expandPermissions([...preset.permissions]))}
          >
            {m.permissionPresets[preset.key as keyof Messages["permissionPresets"]]}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(adminLockedReason ? ["ADMIN"] : [])}
        >
          {m.permissionPresets.clear}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PERMISSION_GROUPS.map((g) => (
          <div key={g.key} className="rounded-md border p-3">
            <div className="text-muted-foreground mb-2 text-xs font-medium">
              {m.permissionGroups[g.key as keyof Messages["permissionGroups"]]}
            </div>
            <div className="space-y-2">
              {g.permissions.map((p) => {
                const hint = hints[p];
                const locked = p === "ADMIN" && !!adminLockedReason;
                return (
                  <label key={p} className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={value.includes(p)}
                      disabled={disabled || locked}
                      onChange={(e) => toggle(p, e.target.checked)}
                    />
                    <span>
                      <span className="block">{m.permissions[p]}</span>
                      {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
                      {locked && (
                        <span className="text-muted-foreground block text-xs">
                          {adminLockedReason}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
