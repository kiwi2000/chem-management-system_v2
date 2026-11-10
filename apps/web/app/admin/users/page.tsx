"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, UserSummaryDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { useOrganisations } from "@/lib/use-organisations";
import { usePermissionGroupOptions } from "@/lib/use-permission-group-options";
import { flattenOrgTree } from "@/lib/org-tree";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "email", direction: "asc" }]);

/** 組織が空の人を選ぶ値（サーバーの ORGANISATION_NONE と同じ） */
const ORGANISATION_NONE = "__none";

export default function UsersPage() {
  const { m, locale } = useI18n();
  const organisations = useOrganisations();
  const groupOptions = usePermissionGroupOptions();

  const columns = useMemo<TableColumn<UserSummaryDto>[]>(
    () => [
      {
        key: "email",
        header: m.users.email,
        kind: "text",
        width: 240,
        className: "font-mono text-xs",
        // 押すと詳細へ移る。製品・物質・法規制のコードと同じ形
        render: (u) => (
          <Link
            href={`/admin/users/${u.id}`}
            onClick={(e) => e.stopPropagation()}
            className="underline underline-offset-2"
          >
            {u.email}
          </Link>
        ),
      },
      {
        key: "displayName",
        header: m.users.displayName,
        kind: "text",
        width: 160,
        render: (u) => u.displayName ?? "",
      },
      {
        // 組織（S31 から 1 つ）。上からの道筋で出す。絞り込みは組織図の並びで選ぶ
        key: "organisation",
        header: m.users.organisation,
        kind: "enum",
        width: 220,
        sortable: false,
        className: "text-muted-foreground text-xs",
        options: [
          { value: ORGANISATION_NONE, label: m.users.permissionGroupsNone },
          ...flattenOrgTree(organisations ?? []).map(({ org, depth }) => ({
            value: org.id,
            label: `${"\u3000".repeat(depth)}${pickName(locale, org.nameJa, org.nameEn)}`,
          })),
        ],
        render: (u) => u.organisationPath ?? "",
      },
      {
        // 入っている権限グループ（S31）。「権限」の列を置き換えた
        key: "permissionGroups",
        header: m.users.permissionGroups,
        kind: "enum",
        width: 260,
        sortable: false,
        options: (groupOptions?.groups ?? []).map((g) => ({
          value: g.id,
          label: pickName(locale, g.nameJa, g.nameEn),
        })),
        render: (u) =>
          u.groups.length === 0 ? (
            <span className="text-muted-foreground text-xs">{m.users.permissionGroupsNone}</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {u.groups.map((g) => (
                <Badge
                  key={g.id}
                  variant={g.isSystemAdmin ? "default" : "secondary"}
                  className="px-1"
                >
                  {pickName(locale, g.nameJa, g.nameEn)}
                </Badge>
              ))}
            </span>
          ),
      },
      {
        key: "activeFlag",
        header: m.common.activeHeader,
        kind: "enum",
        // 選択肢の文言（有効/無効）だけで分かるので、フィルターでは列名を出さない
        filterLabelHidden: true,
        // 見出しの「有効」が切れない幅。切れると何の列か分からなくなる
        width: 76,
        className: "text-center",
        options: [
          { value: "true", label: m.users.active },
          { value: "false", label: m.users.inactive },
        ],
        render: (u) => (
          <StatusIcon
            active={u.activeFlag}
            activeLabel={m.users.active}
            inactiveLabel={m.users.inactive}
          />
        ),
      },
      {
        // 誰がまだ設定していないかが一目で分かるように出す
        key: "mfaMethod",
        header: m.users.mfaHeader,
        kind: "enum",
        filterLabelHidden: true,
        // 見出しの「2要素」が切れない幅
        width: 84,
        className: "text-center",
        sortable: false,
        options: [
          { value: "totp", label: m.mfa.methodTotp },
          { value: "none", label: m.mfa.methodNone },
        ],
        render: (u) => (
          <StatusIcon
            active={u.mfaMethod === "totp"}
            activeLabel={m.mfa.enabled}
            inactiveLabel={m.mfa.notEnabled}
          />
        ),
      },
      {
        key: "lastLoginAt",
        header: m.users.lastLogin,
        kind: "date",
        width: 160,
        className: "text-muted-foreground text-center text-xs",
        render: (u) =>
          u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString(locale) : m.users.never,
      },
    ],
    [m, locale, organisations, groupOptions],
  );

  const { state, setState, ready } = useTableState("chem.table.users", columns, DEFAULT_STATE);

  const [data, setData] = useState<ListResponse<UserSummaryDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/users?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<UserSummaryDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /** 確認は共通テーブル側で出す。自分自身や最後の管理者はサーバーが弾く */
  async function onDeleteSelected(targets: UserSummaryDto[]) {
    setError(null);
    for (const u of targets) {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        title={m.users.title}
        storageKey="chem.table.users.v3"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(u) => u.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={m.users.empty}
        create={{ href: "/admin/users/new" }}
        selectable
        onDeleteSelected={onDeleteSelected}
      />
    </div>
  );
}
