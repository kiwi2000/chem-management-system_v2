"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { useI18n } from "@/lib/i18n-client";
import { useTableState } from "@/lib/use-table-state";

interface Event {
  id: string;
  action: string;
  actorName: string;
  comment: string | null;
  createdAt: string;
}

/** 新しい順。ほかの一覧と同じで、1ページの件数はその人の設定に従う */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "createdAt", direction: "desc" }]);

/**
 * 申請・承認・却下の履歴。
 *
 * 見られるのは編集できる人と承認できる人だけ（サーバー側で判断する）。
 * **ほかの一覧と同じ表にしてある**（2026-09-18 指示）。
 * 以前は直近 50 件だけを並べていて、それが全部のように見えていた
 */
export function ApprovalHistory({
  entity,
  entityId,
}: {
  entity: "product" | "substance";
  entityId: string;
}) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<Event[] | null>(null);
  const [total, setTotal] = useState(0);
  /** 権限が無いときは節ごと出さない（403 が返る） */
  const [forbidden, setForbidden] = useState(false);

  const label = useCallback(
    (action: string) =>
      ({
        SUBMIT: m.common.submit,
        APPROVE: m.common.approve,
        REJECT: m.common.reject,
        WITHDRAW: m.common.withdraw,
        UNPUBLISH: m.common.unpublish,
      })[action] ?? action,
    [m],
  );

  const columns = useMemo<TableColumn<Event>[]>(
    () => [
      {
        key: "createdAt",
        header: m.common.approvalAt,
        kind: "date",
        width: 170,
        className: "whitespace-nowrap text-xs",
        render: (e) => new Date(e.createdAt).toLocaleString(locale),
      },
      {
        key: "action",
        header: m.common.approvalAction,
        kind: "enum",
        width: 110,
        options: ["SUBMIT", "APPROVE", "REJECT", "WITHDRAW", "UNPUBLISH"].map((v) => ({
          value: v,
          label: label(v),
        })),
        render: (e) => label(e.action),
      },
      {
        // 並べ替えは表示名で、絞り込みは表示名とメールの両方を見る（lib/list-columns.ts）
        key: "actorName",
        header: m.common.approvalActor,
        kind: "text",
        width: 160,
        render: (e) => e.actorName,
      },
      {
        key: "comment",
        header: m.common.approvalComment,
        kind: "text",
        sortable: false,
        className: "text-muted-foreground text-xs",
        multiline: true,
        clampLines: 3,
        render: (e) => e.comment ?? "",
      },
    ],
    [m, locale, label],
  );

  const { state, setState, ready } = useTableState(
    "chem.table.approvalEvents",
    columns,
    DEFAULT_STATE,
  );
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/approval-events?entity=${entity}&entityId=${encodeURIComponent(entityId)}&${query}`,
    );
    if (!res.ok) {
      setForbidden(true);
      setItems([]);
      setTotal(0);
      return;
    }
    const body = (await res.json()) as { items: Event[]; total: number };
    setItems(body.items);
    setTotal(body.total);
  }, [entity, entityId, query]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // 権限が無いときと、一度も申請されていないときは節ごと出さない
  const filtering = Object.keys(state.filters).length > 0;
  if (forbidden || items === null || (total === 0 && !filtering)) return null;

  return (
    <DataTable
      title={m.common.approvalHistory}
      storageKey="chem.table.approvalEvents"
      columns={columns}
      rows={items}
      rowKey={(e) => e.id}
      total={total}
      state={state}
      defaultState={DEFAULT_STATE}
      onStateChange={setState}
      emptyMessage={m.common.approvalEmpty}
    />
  );
}
