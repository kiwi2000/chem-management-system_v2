"use client";

import { ChevronRight } from "lucide-react";
import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, UserSummaryDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "email", direction: "asc" }]);

export default function UsersPage() {
  const { m, locale } = useI18n();
  const router = useRouter();

  const columns = useMemo<TableColumn<UserSummaryDto>[]>(
    () => [
      {
        key: "email",
        header: m.users.email,
        kind: "text",
        width: 240,
        className: "font-mono text-xs",
        render: (u) => u.email,
      },
      {
        key: "displayName",
        header: m.users.displayName,
        kind: "text",
        width: 160,
        render: (u) => u.displayName ?? "",
      },
      {
        key: "orgGroup",
        header: m.users.orgGroup,
        kind: "text",
        width: 140,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-xs",
        render: (u) => pickName(locale, u.orgGroupName ?? "", u.orgGroupNameEn),
      },
      {
        key: "newsGroup",
        header: m.users.newsGroup,
        kind: "text",
        width: 140,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-xs",
        render: (u) => pickName(locale, u.newsGroupName ?? "", u.newsGroupNameEn),
      },
      {
        key: "permissions",
        header: m.users.permissions,
        kind: "text",
        width: 120,
        sortable: false,
        filterable: false,
        render: (u) =>
          u.permissions.includes("ADMIN") ? (
            <Badge variant="secondary" className="px-1">
              {m.shell.admin}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">
              {m.users.permissionCount(u.permissions.length)}
            </span>
          ),
      },
      {
        key: "activeFlag",
        header: m.common.activeHeader,
        kind: "enum",
        // 選択肢の文言（有効/無効）だけで分かるので、フィルターでは列名を出さない
        filterLabelHidden: true,
        width: 64,
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
        width: 64,
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
    [m, locale],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.users",
    columns,
    DEFAULT_STATE,
  );

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
      <h1 className="text-2xl font-semibold">{m.users.title}</h1>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.users"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(u) => u.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.users.empty}
        create={{ href: "/admin/users/new" }}
        selectable
        onDeleteSelected={onDeleteSelected}
        // 行の右端の › で詳細画面へ
        rowAction={{
          icon: ChevronRight,
          label: m.common.detail,
          busy: true,
          onClick: (u) => router.push(`/admin/users/${u.id}`),
        }}
      />
    </div>
  );
}
