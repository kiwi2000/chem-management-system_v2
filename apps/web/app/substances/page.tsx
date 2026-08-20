"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { GazetteNumbers } from "@/components/gazette-numbers";
import { StatusIcon } from "@/components/status-icon";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, SubstanceListItemDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

export default function SubstancesPage() {
  const { m, locale } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const editable = can("SUBSTANCE_EDIT");

  const columns = useMemo<TableColumn<SubstanceListItemDto>[]>(
    () => [
      {
        key: "code",
        header: m.substances.code,
        kind: "text",
        // 必須の列。「空白」で絞る意味が無い
        nullable: false,
        // コード20文字・CAS12桁が等幅で収まる最小限の幅にする
        width: 104,
        className: "font-mono text-xs",
        render: (r) => r.code,
      },
      {
        key: "casNumber",
        header: m.substances.casNumber,
        kind: "text",
        width: 104,
        className: "font-mono text-xs",
        render: (r) => r.casNumber ?? "—",
      },
      {
        key: "nameJa",
        header: m.substances.nameJa,
        kind: "text",
        nullable: false,
        width: 240,
        render: (r) => (
          <>
            {pickName(locale, r.nameJa, r.nameEn)}
            {r.aliasCount > 0 && (
              <span className="text-muted-foreground ml-2 text-xs">+{r.aliasCount}</span>
            )}
          </>
        ),
      },
      {
        key: "nameEn",
        header: m.substances.nameEn,
        kind: "text",
        width: 200,
        className: "text-muted-foreground",
        render: (r) => r.nameEn ?? "",
      },
      {
        key: "status",
        header: m.common.activeHeader,
        kind: "enum",
        // 選択肢の文言（有効/無効）だけで分かるので、フィルターでは列名を出さない
        filterLabelHidden: true,
        width: 72,
        className: "text-center",
        options: [
          { value: "ACTIVE", label: m.substances.statusActive },
          { value: "DISCONTINUED", label: m.substances.statusDiscontinued },
        ],
        render: (r) => (
          <StatusIcon
            active={r.status !== "DISCONTINUED"}
            activeLabel={m.substances.statusActive}
            inactiveLabel={m.substances.statusDiscontinued}
          />
        ),
      },
      {
        key: "draftFlag",
        header: m.substances.draftFlag,
        kind: "enum",
        width: 72,
        className: "text-center",
        filterLabelHidden: true,
        options: [
          { value: "true", label: m.substances.draftFlag },
          { value: "false", label: m.substances.draftDone },
        ],
        render: (r) => (
          <StatusIcon
            active={r.draftFlag}
            activeLabel={m.substances.draftFlag}
            inactiveLabel={m.substances.draftDone}
          />
        ),
      },
      {
        key: "gazetteNumbers",
        // 子テーブルを引いた列。「空白」で絞れないので出さない
        nullable: false,
        header: m.substances.gazette,
        kind: "text",
        width: 150,
        // 区分ごとに1行ずつ出すので、行の高さを伸ばす
        multiline: true,
        sortable: false,
        render: (r) => <GazetteNumbers items={r.gazetteNumbers} />,
      },
      {
        key: "note",
        header: m.substances.note,
        kind: "text",
        width: 200,
        className: "text-muted-foreground text-xs",
        render: (r) => r.note ?? "",
      },
      {
        key: "updatedAt",
        header: m.news.updatedAt,
        kind: "date",
        // 必ず入る列。「空白」で絞る意味が無い
        nullable: false,
        width: 92,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ],
    [m, locale],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.substances",
    columns,
    DEFAULT_STATE,
  );

  const [data, setData] = useState<ListResponse<SubstanceListItemDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => serializeTableState(state, DEFAULT_STATE).toString(),
    // 文字列にしてから依存させることで、同じ条件での再取得を防ぐ
    [state],
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/substances?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: state.pageSize });
      return;
    }
    setData((await res.json()) as ListResponse<SubstanceListItemDto>);
    // state.pageSize はエラー時の表示にしか使わないので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /** 確認は共通テーブル側で出す。ここは消す処理だけ */
  async function onDeleteSelected(targets: SubstanceListItemDto[]) {
    setError(null);
    for (const s of targets) {
      const res = await fetch(`/api/substances/${s.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    void load();
  }

  /** 選択した行をまとめて完成にする。権限が無いものはサーバー側で飛ばされる */
  async function onMarkDoneSelected(targets: SubstanceListItemDto[]) {
    setError(null);
    const res = await fetch("/api/substances/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targets.map((t) => t.id), draftFlag: false }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    const body = (await res.json()) as { updated: number; requested: number };
    if (body.updated < body.requested) {
      setError(m.common.markedSome(body.updated, body.requested));
    }
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.substances.title}</h1>
        {editable && (
          <Button nativeButton={false} render={<Link href="/substances/new" />}>
            {m.common.create}
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.substances"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.substances.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        onMarkDoneSelected={onMarkDoneSelected}
        onRowActivate={(s) => router.push(`/substances/${s.id}`)}
      />
    </div>
  );
}
