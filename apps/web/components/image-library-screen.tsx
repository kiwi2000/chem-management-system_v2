"use client";

import {
  emptyTableState,
  serializeTableState,
  type ColumnKind,
  type TableState,
} from "@chem/shared";
import { Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ImageAssetDto, ListResponse } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "createdAt", direction: "desc" }]);

const columnKinds = [
  { key: "name", kind: "text" },
  { key: "note", kind: "text" },
  { key: "mime", kind: "enum" },
  { key: "createdAt", kind: "date" },
] satisfies { key: string; kind: ColumnKind }[];

/** 容量の読みやすい書きかた */
function kb(n: number): string {
  return n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * 画像ライブラリ（2026-09-16 指示）。
 * テンプレートの「画像」ブロックで使うロゴ・印影・写真を、テンプレートをまたいで使い回す。
 * まとめてアップロード → 入れるときにシステム設定の決まりで整える。名前と備考は行の鉛筆で直す。
 * 使っているテンプレートがある画像は消せない
 */
export function ImageLibraryScreen() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("DOC_TEMPLATE_EDIT");

  const { state, setState, ready } = useTableState("chem.table.images", columnKinds, DEFAULT_STATE);
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);
  const [data, setData] = useState<ListResponse<ImageAssetDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** 行の中で名前と備考を直す */
  const [editing, setEditing] = useState<{ id: string; name: string; note: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/images?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 25 });
      return;
    }
    setData((await res.json()) as ListResponse<ImageAssetDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/images", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        { added: { id: string }[]; rejected: { name: string; reason: string }[] } | ApiError | null;
      if (!body || !("added" in body)) {
        if (redirectIfUnauthorized(res)) return;
        setError((body as ApiError | null)?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      if (body.added.length > 0) setNotice(m.images.uploaded(body.added.length));
      if (body.rejected.length > 0) {
        setError(body.rejected.map((r) => m.images.rejected(r.name, r.reason)).join(" / "));
      }
      void load();
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onDeleteSelected(targets: ImageAssetDto[]) {
    setError(null);
    for (const img of targets) {
      const res = await fetch(`/api/images/${img.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    void load();
  }

  async function saveEdit() {
    if (!editing) return;
    setError(null);
    const res = await fetch(`/api/images/${editing.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editing.name, note: editing.note || null }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    setEditing(null);
    setNotice(m.images.saved);
    void load();
  }

  const columns = useMemo<TableColumn<ImageAssetDto>[]>(
    () => [
      {
        key: "preview",
        header: m.images.preview,
        kind: "text",
        width: 120,
        sortable: false,
        filterable: false,
        className: "py-1",
        render: (r) => (
          // eslint-disable-next-line @next/next/no-img-element -- DB から出す絵。next/image は使えない
          <img
            src={`/api/images/${r.id}?thumb=1`}
            alt=""
            className="h-14 max-w-28 object-contain"
            title={`${r.width}×${r.height}px`}
          />
        ),
      },
      {
        key: "name",
        header: m.images.name,
        kind: "text",
        nullable: false,
        width: 240,
        render: (r) =>
          editing?.id === r.id ? (
            <Input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveEdit();
                if (e.key === "Escape") setEditing(null);
              }}
              className="h-8"
              autoFocus
            />
          ) : (
            r.name
          ),
      },
      {
        key: "note",
        header: m.images.note,
        kind: "text",
        width: 260,
        className: "text-muted-foreground text-xs",
        render: (r) =>
          editing?.id === r.id ? (
            <div className="flex items-center gap-2">
              <Input
                value={editing.note}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveEdit();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="h-8"
              />
              <Button size="sm" onClick={() => void saveEdit()}>
                {m.common.save}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                {m.common.cancel}
              </Button>
            </div>
          ) : (
            (r.note ?? "")
          ),
      },
      {
        key: "mime",
        header: m.images.format,
        kind: "enum",
        width: 80,
        options: [
          { value: "image/png", label: "PNG" },
          { value: "image/jpeg", label: "JPEG" },
        ],
        render: (r) => (r.mime === "image/png" ? "PNG" : "JPEG"),
      },
      {
        key: "dimensions",
        header: m.images.dimensions,
        kind: "text",
        width: 110,
        sortable: false,
        filterable: false,
        className: "text-right font-mono text-xs",
        render: (r) => `${r.width}×${r.height}`,
      },
      {
        key: "size",
        header: m.images.size,
        kind: "text",
        width: 90,
        sortable: false,
        filterable: false,
        className: "text-right font-mono text-xs",
        render: (r) => kb(r.size),
      },
      {
        key: "usedBy",
        header: m.images.usedBy,
        kind: "text",
        width: 180,
        sortable: false,
        filterable: false,
        // コードを並べる。テンプレートを直せる人には編集画面へのリンク（権限が無ければ文字だけ）
        render: (r) =>
          r.usedBy.length === 0 ? (
            ""
          ) : (
            <span className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-xs">
              {r.usedBy.map((t) =>
                editable ? (
                  <Link
                    key={t.id}
                    href={`/doc-templates/${t.id}`}
                    title={t.nameJa}
                    className="underline underline-offset-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t.code}
                  </Link>
                ) : (
                  <span key={t.id} title={t.nameJa}>
                    {t.code}
                  </span>
                ),
              )}
            </span>
          ),
      },
      {
        key: "createdAt",
        header: m.images.createdAt,
        kind: "date",
        nullable: false,
        width: 110,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.createdAt).toLocaleDateString(locale),
      },
    ],
    // saveEdit は editing を閉じ込めた関数。editing が変われば列も作り直すので、依存はこれで足りる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, locale, editing, editable],
  );

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{m.images.title}</h1>
        <p className="text-muted-foreground text-sm">{m.images.lead}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <DataTable
        storageKey="chem.table.images"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={m.images.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        headerActions={
          editable ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" />
                {busy ? m.images.uploading : m.images.upload}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void upload(e.target.files)}
              />
            </>
          ) : undefined
        }
        rowAction={
          editable
            ? { onClick: (r) => setEditing({ id: r.id, name: r.name, note: r.note ?? "" }) }
            : undefined
        }
        hintText={m.images.uploadHint}
      />
    </div>
  );
}
