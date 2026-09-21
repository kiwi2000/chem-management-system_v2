"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import type { ApiError, ListResponse, PrtrGroupDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const STORAGE_KEY = "chem.table.prtrGroups";
const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** グループ（届出上の事業所）の一覧（S22-1）。詳細はコードのリンクから、削除は先頭のチェックでまとめて */
export default function PrtrGroupsPage() {
  const { m, locale } = useI18n();
  const router = useRouter();
  const t = m.prtr.groups;
  const [data, setData] = useState<ListResponse<PrtrGroupDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<TableColumn<PrtrGroupDto>[]>(
    () => [
      {
        key: "code",
        header: t.code,
        kind: "text",
        width: 120,
        className: "font-mono text-xs",
        render: (g) => (
          <Link href={`/prtr/groups/${g.id}`} className="text-primary underline">
            {g.code}
          </Link>
        ),
      },
      {
        key: "nameJa",
        header: t.name,
        kind: "text",
        width: 240,
        render: (g) => pickName(locale, g.nameJa, g.nameEn),
      },
      {
        key: "prefecture",
        header: t.prefecture,
        kind: "text",
        width: 120,
        render: (g) => g.prefecture ?? "",
      },
      {
        key: "employeeNum",
        header: t.employeeNum,
        kind: "number",
        width: 120,
        className: "text-right tabular-nums text-xs",
        render: (g) => (g.employeeNum === null ? "" : g.employeeNum.toLocaleString(locale)),
      },
      {
        key: "siteCount",
        header: t.siteCount,
        kind: "number",
        width: 80,
        sortable: false,
        filterable: false,
        className: "text-right text-xs",
        render: (g) => String(g.siteCount),
      },
      {
        key: "userCount",
        header: t.userCount,
        kind: "number",
        width: 80,
        sortable: false,
        filterable: false,
        className: "text-right text-xs",
        render: (g) => String(g.userCount),
      },
      {
        key: "displayOrder",
        header: t.displayOrder,
        kind: "number",
        width: 88,
        className: "text-right text-xs",
        render: (g) => String(g.displayOrder),
      },
    ],
    [t, locale],
  );

  const { state, setState } = useTableState(STORAGE_KEY, columns, DEFAULT_STATE);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(
      `/api/prtr/groups?${serializeTableState(state, DEFAULT_STATE).toString()}`,
    ).catch(() => null);
    if (!res?.ok) {
      if (res) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
      }
      return;
    }
    setData((await res.json()) as ListResponse<PrtrGroupDto>);
  }, [state, m]);

  useEffect(() => {
    void load();
  }, [load]);

  async function removeSelected(rows: PrtrGroupDto[]) {
    setError(null);
    for (const g of rows) {
      const res = await fetch(`/api/prtr/groups/${g.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    await load();
  }

  return (
    <div className={PAGE_SHELL_STACKED}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t.lead}</p>
        </div>
        <Button size="sm" onClick={() => router.push("/prtr/groups/new")}>
          {t.add}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DataTable
        storageKey={STORAGE_KEY}
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(g) => g.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={t.empty}
        selectable
        onDeleteSelected={(rows) => void removeSelected(rows)}
      />
    </div>
  );
}
