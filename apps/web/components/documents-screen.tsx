"use client";

import {
  DOCUMENT_TARGETS,
  emptyTableState,
  pickName,
  serializeTableState,
  type ColumnKind,
  type TableState,
} from "@chem/shared";
import { FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  DocumentTemplateDto,
  GeneratedDocumentDto,
  ListResponse,
} from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "generatedAt", direction: "desc" }]);

const columnKinds = [
  { key: "targetCode", kind: "text" },
  { key: "templateCode", kind: "text" },
  { key: "target", kind: "enum" },
  { key: "hasComposition", kind: "enum" },
  { key: "generatedAt", kind: "date" },
] satisfies { key: string; kind: ColumnKind }[];

/** 日時。秒までは要らない（一覧で読むのは「いつごろか」） */
function fmt(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * ドキュメント生成の画面。
 *
 * 上で**様式を選んで作り**、下に**自分が作ったもの**が並ぶ。
 * 様式そのものを直すのは別の画面（テンプレート編集）で、要る権限も違う。
 */
export function DocumentsScreen() {
  const { m, locale } = useI18n();
  const router = useRouter();

  const [templates, setTemplates] = useState<DocumentTemplateDto[] | null>(null);
  const [data, setData] = useState<ListResponse<GeneratedDocumentDto> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.documents",
    columnKinds,
    DEFAULT_STATE,
  );
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/doc-templates?size=200").catch(() => null);
      if (!res || !res.ok || !alive) return;
      const body = (await res.json()) as ListResponse<DocumentTemplateDto>;
      // 使えないものは選ばせない
      if (alive) setTemplates(body.items.filter((t) => t.active));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/documents?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<GeneratedDocumentDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const columns: TableColumn<GeneratedDocumentDto>[] = useMemo(
    () => [
      {
        key: "generatedAt",
        header: m.documents.generatedAt,
        kind: "date",
        width: 140,
        className: "whitespace-nowrap",
        // 押すと、出したときの紙面をそのまま開く（作り直さない）
        render: (d) => (
          <Link href={`/documents/saved/${d.id}`} className="underline underline-offset-2">
            {fmt(d.generatedAt, locale)}
          </Link>
        ),
      },
      {
        key: "templateCode",
        header: m.documents.template,
        kind: "text",
        width: 200,
        render: (d) => `${d.templateCode} ${pickName(locale, d.templateNameJa, d.templateNameEn)}`,
      },
      {
        key: "target",
        header: m.documents.targetKind,
        kind: "enum",
        width: 88,
        options: DOCUMENT_TARGETS.map((v) => ({ value: v, label: m.docTemplates.targets[v] })),
        render: (d) => m.docTemplates.targets[d.target],
      },
      {
        key: "targetCode",
        header: m.documents.targetCode,
        kind: "text",
        width: 170,
        className: "font-mono text-xs",
      },
      {
        key: "hasComposition",
        header: m.documents.hasComposition,
        kind: "enum",
        width: 96,
        options: [
          { value: "true", label: m.common.yes },
          { value: "false", label: m.common.no },
        ],
        render: (d) => (d.hasComposition ? m.common.yes : ""),
      },
      {
        key: "version",
        header: m.documents.version,
        kind: "text",
        width: 96,
        sortable: false,
        filterable: false,
        render: (d) => d.version,
      },
    ],
    [m, locale],
  );

  const usable = templates ?? [];

  return (
    <div className="w-full space-y-4 p-3 pb-10 lg:p-4 lg:pb-12">
      <h1 className="text-2xl font-semibold">{m.nav.documentCreate}</h1>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 上：様式を選んで作る */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{m.documents.chooseTemplate}</p>
        {usable.length === 0 ? (
          <p className="text-muted-foreground text-sm">{m.documents.noTemplate}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {usable.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant="outline"
                onClick={() =>
                  router.push(
                    `${t.target === "PRODUCT" ? "/products" : "/substances"}?pickFor=${t.id}`,
                  )
                }
              >
                <FileText className="size-4" />
                {t.code} {pickName(locale, t.nameJa, t.nameEn)}
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* 下：自分が作ったもの */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-sm font-medium">{m.documents.mine}</p>
        <DataTable
          storageKey="chem.table.documents"
          columns={columns}
          rows={data?.items ?? null}
          rowKey={(d) => d.id}
          total={data?.total ?? 0}
          state={state}
          defaultState={DEFAULT_STATE}
          onStateChange={setState}
          onReset={reset}
          emptyMessage={m.documents.noneYet}
          pageSizeOptions={[10, 25, 50, 100]}
          hintText={m.documents.savedHint}
        />
      </div>
    </div>
  );
}
