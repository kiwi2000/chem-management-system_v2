"use client";

import { emptyTableState, serializeTableState, type Locale, type TableState } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { GHS_CATALOG } from "../ghs/catalog-data";
import type { GhsSourceRowDto } from "../ghs/data-dto";
import { sdsMessages } from "../messages";
import { categoryText } from "./ghs-data-table";

const DEFAULT_STATE: TableState = emptyTableState([
  { column: "sourceKey", direction: "asc" },
  { column: "effectiveFrom", direction: "asc" },
]);

/**
 * 出典ごとの表: 行＝出典の項目（識別子・版ごと）。出典の中身をそのまま見るためのもので、
 * 物質マスタとの結び付き（CAS）は「物質コード」の列に出すだけ
 */
export function GhsSourceTable({
  locale,
  sourceCode,
  sourceName,
}: {
  locale: Locale;
  sourceCode: string;
  sourceName: string;
}) {
  const { m } = useI18n();
  const t = sdsMessages(locale);
  const ja = locale === "ja";
  const storageKey = `chem.table.sdsGhsSource.${sourceCode}`;
  const [data, setData] = useState<ListResponse<GhsSourceRowDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<TableColumn<GhsSourceRowDto>[]>(
    () => [
      {
        key: "sourceKey",
        header: t.data.source.columns.key,
        kind: "text",
        width: 130,
        render: (r) => (r.subKey ? `${r.sourceKey} ${r.subKey}` : r.sourceKey),
      },
      {
        key: ja ? "name" : "nameEn",
        header: t.data.source.columns.name,
        kind: "text",
        width: 220,
        render: (r) => (ja ? r.name : (r.nameEn ?? r.name)),
      },
      {
        key: "casNumber",
        header: t.data.source.columns.cas,
        kind: "list",
        width: 120,
        sortable: false,
        render: (r) => r.cas.join(", "),
      },
      {
        key: "ecNumber",
        header: t.data.source.columns.ec,
        kind: "text",
        width: 100,
        render: (r) => r.ecNumber ?? "",
      },
      {
        key: "conditionText",
        header: t.data.source.columns.condition,
        kind: "text",
        width: 120,
        render: (r) => r.conditionText ?? "",
      },
      {
        key: "effectiveFrom",
        header: t.data.source.columns.from,
        kind: "date",
        width: 100,
        render: (r) => r.effectiveFrom,
      },
      {
        key: "effectiveTo",
        header: t.data.source.columns.to,
        kind: "date",
        width: 100,
        render: (r) => r.effectiveTo ?? "",
      },
      {
        key: "substances",
        header: t.data.source.columns.substances,
        kind: "text",
        width: 130,
        sortable: false,
        filterable: false,
        render: (r) =>
          r.substances.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <Link
                href={`/substances/${s.id}`}
                className="text-primary underline-offset-2 hover:underline"
                title={s.via ? t.data.layers.viaTag(t.data.sourceShort[s.via] ?? s.via) : undefined}
              >
                {s.code}
              </Link>
              {s.via && (
                <span className="text-muted-foreground ml-0.5 text-[10px]">
                  {t.data.sourceShort[s.via] ?? s.via}
                </span>
              )}
            </span>
          )),
      },
      ...GHS_CATALOG.map((cls): TableColumn<GhsSourceRowDto> => ({
        key: `cls:${cls.code}`,
        header: ja ? (cls.shortJa ?? cls.nameJa) : (cls.shortEn ?? cls.abbrevEn),
        kind: "text",
        width: 104,
        minWidth: 104,
        sortable: false,
        filterable: false,
        render: (r) => {
          const c = r.cells[cls.code];
          if (!c) return null;
          if (c.status !== "CLASSIFIED")
            return <span className="text-muted-foreground text-xs">{t.ghs.status[c.status]}</span>;
          return (
            <span className="font-medium">
              {c.items.map((it, i) => (
                <span key={it.category}>
                  {i > 0 && "、"}
                  {categoryText(cls.code, it.category, ja, t.ghs.section.classifiedUnspecified)}
                  {it.minimumClassification && (
                    <sup className="text-muted-foreground ml-0.5">{it.minimumClassification}</sup>
                  )}
                  {it.targetOrgans && (
                    <span className="text-muted-foreground ml-1 text-[10px] font-normal">
                      {it.targetOrgans}
                    </span>
                  )}
                </span>
              ))}
            </span>
          );
        },
      })),
    ],
    [t, ja],
  );

  const { state, setState, ready } = useTableState(storageKey, columns, DEFAULT_STATE, "src");
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);
  const load = useCallback(async () => {
    const res = await fetch(
      `/api/modules/sds/ghs-data/source?sourceCode=${encodeURIComponent(sourceCode)}&${query}`,
    );
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setError(null);
    setData((await res.json()) as ListResponse<GhsSourceRowDto>);
  }, [sourceCode, query, m]);
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{t.data.source.lead(sourceName)}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DataTable
        storageKey={storageKey}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={t.data.source.empty}
      />
    </div>
  );
}
