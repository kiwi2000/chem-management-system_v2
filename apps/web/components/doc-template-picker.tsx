"use client";

import {
  DOCUMENT_TARGETS,
  DOCUMENT_TEMPLATE_KINDS,
  emptyTableState,
  pickName,
  serializeTableState,
  type ColumnKind,
  type TableState,
} from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, DocumentTemplateDto, ListResponse } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/**
 * 使う様式を選ぶ表。
 *
 * **表にする。**様式が増えるとボタンを並べただけでは探せない。
 * 絞り込みと並べ替えが要る（コード・名称・対象・作りかた）。
 *
 * 出すのは**使える様式だけ**。止めてあるものは選ばせない
 */

const DEFAULT_STATE: TableState = emptyTableState([{ column: "seq", direction: "asc" }]);

const columnKinds = [
  { key: "code", kind: "text" },
  { key: "nameJa", kind: "text" },
  { key: "target", kind: "enum" },
  { key: "kind", kind: "enum" },
] satisfies { key: string; kind: ColumnKind }[];

export function DocTemplatePicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (template: DocumentTemplateDto) => void;
}) {
  const { m, locale } = useI18n();
  const { state, setState, reset, ready } = useTableState(
    "chem.table.docPickTemplate",
    columnKinds,
    DEFAULT_STATE,
  );
  const query = useMemo(() => {
    const params = serializeTableState(state, DEFAULT_STATE);
    // 止めてある様式は出さない。利用者が外せる条件ではないので、ここで足す
    params.set("f.active", "in:true");
    return params.toString();
  }, [state]);

  const [data, setData] = useState<ListResponse<DocumentTemplateDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/doc-templates?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 10 });
      return;
    }
    setData((await res.json()) as ListResponse<DocumentTemplateDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const columns: TableColumn<DocumentTemplateDto>[] = useMemo(
    () => [
      {
        key: "code",
        header: m.docTemplates.code,
        kind: "text",
        nullable: false,
        width: 160,
        className: "font-mono text-xs",
        render: (t) => t.code,
      },
      {
        key: "nameJa",
        header: m.docTemplates.nameJa,
        kind: "text",
        nullable: false,
        width: 320,
        render: (t) => pickName(locale, t.nameJa, t.nameEn),
      },
      {
        key: "target",
        header: m.docTemplates.target,
        kind: "enum",
        width: 88,
        options: DOCUMENT_TARGETS.map((v) => ({ value: v, label: m.docTemplates.targets[v] })),
        render: (t) => m.docTemplates.targets[t.target],
      },
      {
        key: "kind",
        header: m.docTemplates.kind,
        kind: "enum",
        width: 104,
        options: DOCUMENT_TEMPLATE_KINDS.map((v) => ({
          value: v,
          label: m.docTemplates.kinds[v],
        })),
        render: (t) => m.docTemplates.kinds[t.kind],
      },
    ],
    [m, locale],
  );

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DataTable
        storageKey="chem.table.docPickTemplate"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(t) => t.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.documents.noTemplate}
        // 1つだけ選ぶ。行を押すと選ばれる（チェックは要らない）
        selectedKey={selectedId}
        onRowSelect={onSelect}
        pageSizeOptions={[5, 10, 15, 25]}
        hintText={m.documents.pickTemplateHint}
      />
    </div>
  );
}
