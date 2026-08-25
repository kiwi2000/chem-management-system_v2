"use client";

import { ChevronRight } from "lucide-react";
import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, NewsDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

const DEFAULT_STATE: TableState = emptyTableState([
  { column: "pinned", direction: "desc" },
  { column: "publishFrom", direction: "desc" },
]);

export default function NewsListPage() {
  const { m, locale } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const canPost = can("NEWS_POST");

  const columns = useMemo<TableColumn<NewsDto>[]>(
    () => [
      {
        key: "titleJa",
        header: m.news.titleJa,
        kind: "text",
        width: 320,
        render: (n) => (
          <>
            {n.pinned && (
              <Badge variant="destructive" className="mr-2 px-1 text-[10px]">
                {m.news.pinnedShort}
              </Badge>
            )}
            {pickName(locale, n.titleJa, n.titleEn)}
          </>
        ),
      },
      {
        key: "status",
        header: m.news.status,
        kind: "enum",
        width: 90,
        options: [
          { value: "PUBLISHED", label: m.news.published },
          { value: "DRAFT", label: m.news.draft },
        ],
        render: (n) => (
          <Badge variant={n.status === "PUBLISHED" ? "secondary" : "outline"} className="px-1">
            {n.status === "PUBLISHED" ? m.news.published : m.news.draft}
          </Badge>
        ),
      },
      {
        key: "pinned",
        header: m.news.pinnedShort,
        kind: "enum",
        width: 72,
        options: [
          { value: "true", label: m.common.yes },
          { value: "false", label: m.common.no },
        ],
        render: (n) => (n.pinned ? m.common.yes : ""),
      },
      {
        key: "publishFrom",
        header: m.news.publishFrom,
        kind: "date",
        width: 170,
        className: "text-muted-foreground text-center text-xs",
        render: (n) => `${n.publishFrom ?? "—"}${n.publishUntil ? ` 〜 ${n.publishUntil}` : ""}`,
      },
      {
        key: "author",
        header: m.news.author,
        kind: "text",
        width: 140,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-xs",
        render: (n) => n.authorName,
      },
      {
        key: "updatedAt",
        header: m.news.updatedAt,
        kind: "date",
        // 必ず入る列。「空白」で絞る意味が無い
        nullable: false,
        width: 92,
        className: "text-muted-foreground text-center text-xs",
        render: (n) => new Date(n.updatedAt).toLocaleDateString(locale),
      },
    ],
    [m, locale],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.news",
    columns,
    DEFAULT_STATE,
  );

  const [data, setData] = useState<ListResponse<NewsDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/news?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<NewsDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /** 確認は共通テーブル側で出す。自分が編集できないものは弾かれる */
  async function onDeleteSelected(targets: NewsDto[]) {
    setError(null);
    for (const n of targets) {
      const res = await fetch(`/api/news/${n.id}`, { method: "DELETE" });
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
      <h1 className="text-2xl font-semibold">{m.news.title}</h1>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.news"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(n) => n.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.news.empty}
        create={canPost ? { href: "/news/new" } : undefined}
        selectable={canPost}
        onDeleteSelected={onDeleteSelected}
        // 行の右端の › で詳細画面へ
        rowAction={{
          icon: ChevronRight,
          label: m.common.detail,
          busy: true,
          onClick: (n) => router.push(`/news/${n.id}`),
        }}
      />
    </div>
  );
}
