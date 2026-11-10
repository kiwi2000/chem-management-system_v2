"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, PermissionGroupListItemDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

/**
 * 権限グループの一覧（S31 画面設計 2 章）。
 * 詳細へは先頭のコードから。削除は左のチェックでまとめて（システム管理グループは選べない）
 */
export default function PermissionGroupsPage() {
  const { m, locale } = useI18n();
  const columns = useMemo<TableColumn<PermissionGroupListItemDto>[]>(
    () => [
      {
        key: "code",
        header: m.permGroups.code,
        kind: "text",
        width: 200,
        className: "font-mono text-xs",
        render: (g) => (
          <span className="flex items-center gap-2">
            <Link
              href={`/admin/permission-groups/${g.id}`}
              onClick={(e) => e.stopPropagation()}
              className="underline underline-offset-2"
            >
              {g.code}
            </Link>
            {g.isSystemAdmin && <Badge className="px-1">{m.permGroups.systemAdmin}</Badge>}
          </span>
        ),
      },
      {
        key: "nameJa",
        header: m.permGroups.nameJa,
        kind: "text",
        width: 200,
        render: (g) => pickName(locale, g.nameJa, g.nameEn),
      },
      {
        key: "memberCount",
        header: m.permGroups.memberCount,
        kind: "number",
        width: 110,
        className: "text-right tabular-nums",
        render: (g) => g.memberCount.toLocaleString(),
      },
      {
        key: "productCount",
        header: m.permGroups.productCount,
        kind: "number",
        width: 150,
        className: "text-right tabular-nums",
        render: (g) => g.productCount.toLocaleString(),
      },
      {
        key: "substanceCount",
        header: m.permGroups.substanceCount,
        kind: "number",
        width: 120,
        className: "text-right tabular-nums",
        render: (g) => g.substanceCount.toLocaleString(),
      },
      {
        key: "targets",
        header: m.permGroups.targets,
        kind: "text",
        width: 320,
        sortable: false,
        className: "text-muted-foreground text-xs",
        render: (g) =>
          g.isSystemAdmin
            ? m.permGroups.targetsAll
            : g.targets
                .map((t) => pickName(locale, t.nameJa, t.nameEn))
                .join(locale === "ja" ? "・" : ", "),
      },
    ],
    [m, locale],
  );

  const { state, setState, ready } = useTableState(
    "chem.table.permissionGroups",
    columns,
    DEFAULT_STATE,
  );
  const [data, setData] = useState<ListResponse<PermissionGroupListItemDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/admin/permission-groups?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<PermissionGroupListItemDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /** 確認は共通テーブル側で出す。消せないもの（人・データがある）はサーバーが断り、その理由を出す */
  async function onDeleteSelected(targets: PermissionGroupListItemDto[]) {
    setError(null);
    const failed: string[] = [];
    for (const g of targets) {
      const res = await fetch(`/api/admin/permission-groups/${g.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        failed.push(body?.error.message ?? m.errors.deleteFailed);
      }
    }
    if (failed.length > 0) setError(failed.join("\n"));
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
        </Alert>
      )}
      <DataTable
        title={m.permGroups.title}
        storageKey="chem.table.permissionGroups.v1"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(g) => g.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={m.permGroups.empty}
        create={{ href: "/admin/permission-groups/new" }}
        selectable
        onDeleteSelected={onDeleteSelected}
      />
    </div>
  );
}
