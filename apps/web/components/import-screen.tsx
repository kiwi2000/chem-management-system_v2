"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ImportJobDto } from "@/lib/import/dto";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import type { ApiError, ListResponse } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "createdAt", direction: "desc" }]);

/** 日時。秒までは要らない */
export function fmtWhen(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(locale === "en" ? "en-US" : "ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 状態の色。確認待ちと失敗は目に付くように */
export function statusVariant(
  status: ImportJobDto["status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "STAGED") return "default";
  if (status === "FAILED") return "destructive";
  if (status === "DONE") return "secondary";
  return "outline";
}

/**
 * インポート（決定 0011）。
 *
 * 上でファイルを上げると、種類を見分けて**詳細の画面へ移る**。そこで概要を見てから「インポート」を押す。
 * 下は取り込みの履歴。押すと詳細（確認待ちなら一時領域の内容）が開く
 */
export function ImportScreen() {
  const { m, locale } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<TableColumn<ImportJobDto>[]>(
    () => [
      {
        key: "createdAt",
        header: m.importExport.createdAt,
        kind: "date",
        width: 140,
        className: "whitespace-nowrap",
        render: (j) => (
          <Link href={`/import-export/import/${j.id}`} className="underline underline-offset-2">
            {fmtWhen(j.createdAt, locale)}
          </Link>
        ),
      },
      {
        key: "fileName",
        header: m.importExport.fileName,
        kind: "text",
        width: 260,
        render: (j) => j.fileName,
      },
      {
        key: "kind",
        header: m.importExport.kind,
        kind: "enum",
        width: 160,
        options: (Object.keys(m.importExport.kinds) as ImportJobDto["kind"][]).map((k) => ({
          value: k,
          label: m.importExport.kinds[k],
        })),
        render: (j) => m.importExport.kinds[j.kind],
      },
      {
        key: "status",
        header: m.importExport.status,
        kind: "enum",
        width: 110,
        options: (Object.keys(m.importExport.statuses) as ImportJobDto["status"][]).map((s) => ({
          value: s,
          label: m.importExport.statuses[s],
        })),
        render: (j) => (
          <Badge variant={statusVariant(j.status)}>{m.importExport.statuses[j.status]}</Badge>
        ),
      },
      {
        key: "rows",
        header: m.importExport.rows,
        kind: "number",
        width: 90,
        sortable: false,
        filterable: false,
        className: "text-right tabular-nums",
        render: (j) => j.summary?.rows?.toLocaleString() ?? "",
      },
      {
        key: "createdBy",
        header: m.importExport.createdBy,
        kind: "text",
        width: 140,
        sortable: false,
        filterable: false,
        render: (j) => j.createdByName ?? "",
      },
      {
        key: "appliedAt",
        header: m.importExport.appliedAt,
        kind: "date",
        width: 140,
        className: "whitespace-nowrap",
        render: (j) => fmtWhen(j.appliedAt, locale),
      },
    ],
    [m, locale],
  );

  const { state, setState, ready } = useTableState("chem.table.imports", columns, DEFAULT_STATE);
  const [data, setData] = useState<ListResponse<ImportJobDto> | null>(null);
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/import?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<ImportJobDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // 読み取り中・反映中のものが並んでいるあいだは、数秒おきに取り直す
  const busy = data?.items.some((j) => j.status === "LOADING" || j.status === "APPLYING") ?? false;
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(id);
  }, [busy, load]);

  async function upload() {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: form });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const job = (await res.json()) as { id: string };
      // 概要を見せてから「インポート」を押してもらう。その画面は詳細と同じ
      router.push(`/import-export/import/${job.id}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={PAGE_SHELL_STACKED}>
      <Breadcrumbs items={[{ label: m.nav.importExport }, { label: m.nav.dataImport }]} />
      <h1 className="text-xl font-semibold">{m.importExport.importTitle}</h1>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ファイルを上げる。種類は中身から見分けるので、ここでは選ばせない */}
      <div className="border-border bg-muted/30 max-w-3xl space-y-3 border p-4">
        <p className="text-muted-foreground text-sm leading-relaxed">{m.importExport.fileHint}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".tsv,.csv,.txt,.json,.zip"
            aria-label={m.importExport.pickFile}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="border-input bg-background file:bg-muted file:text-foreground h-8 max-w-full border text-sm file:mr-3 file:h-full file:border-0 file:px-3"
          />
          <Button disabled={!file || uploading} onClick={upload}>
            <Upload className="size-4" />
            {uploading ? m.importExport.uploading : m.importExport.upload}
          </Button>
        </div>
      </div>

      <DataTable
        title={m.importExport.history}
        storageKey="chem.table.imports"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(j) => j.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={m.importExport.noneYet}
        pageSizeOptions={[15, 25, 50]}
      />
    </div>
  );
}
