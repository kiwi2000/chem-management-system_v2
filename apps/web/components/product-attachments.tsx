"use client";

import {
  attachmentAccept,
  emptyTableState,
  isPreviewable,
  serializeTableState,
  type TableState,
} from "@chem/shared";
import { Paperclip } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttachmentPreview } from "@/components/attachment-preview";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, ProductAttachmentDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

/** 既定は並べ替えなし（サーバーが新しいものを上にする） */
const DEFAULT_STATE: TableState = emptyTableState([]);

/** 追加中の行を指す仮の id。まだ保存されていないので実在しない */
const NEW_ID = "__new__";

/** 表の中の入力欄。行の高さを変えないよう小さめにする */
const CELL_INPUT = "h-7 w-full text-sm";

interface Draft {
  title: string;
  kind: string;
  description: string;
}
const EMPTY: Draft = { title: "", kind: "", description: "" };

/** 追加中に先頭へ出す、まだ保存していない行 */
const NEW_ROW: ProductAttachmentDto = {
  id: NEW_ID,
  title: "",
  kind: null,
  description: null,
  fileName: "",
  mime: "",
  size: 0,
  createdAt: "",
  createdByName: null,
};

/** サイズを読みやすく（12 KB / 3.4 MB） */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
}

/**
 * 製品・原材料の添付ファイル（2026-09-27 指示）。法規制判定の下、備考の上に置く。
 *
 * **共通の表に載せる**（並べ替え・絞り込み・ページ送り・先頭のチェックでまとめて削除・右端の鉛筆で行を直す・
 * 「＋」で足す）。見られるのは組成を見られる人だけで、見られない人には画面がこのカードごと出さない。
 * 件名を押すと、ブラウザで見られる形式（PDF・画像・テキスト）はポップアップで中身を見せる。
 * ファイル名を押すとダウンロード。
 *
 * 足すときは「＋」でまずファイルを選ばせ、選んだときだけ表に行を作って件名などを待つ
 * （選ぶのをやめたら何もしない。2026-09-27 指示）
 */
export function ProductAttachments({
  productId,
  canEdit,
  maxMb,
  allowMacros,
  extensions,
  kinds,
}: {
  productId: string;
  /** 製品を編集でき、組成を見られる人 */
  canEdit: boolean;
  /** システム設定の上限（MB）・マクロの扱い・受け付ける拡張子・種類の選択肢 */
  maxMb: number;
  allowMacros: boolean;
  extensions: string[];
  kinds: string[];
}) {
  const { m } = useI18n();
  const t = m.attachments;
  const base = `/api/products/${productId}/attachments`;
  const fileInput = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<ListResponse<ProductAttachmentDto> | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [original, setOriginal] = useState<Draft>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** プレビューを開いている添付 */
  const [previewing, setPreviewing] = useState<ProductAttachmentDto | null>(null);

  /** 種類の選択肢。いま付いている値が選択肢から消えていても選べるよう足す */
  const kindChoices = useCallback(
    (current: string | null) => (current && !kinds.includes(current) ? [...kinds, current] : kinds),
    [kinds],
  );

  const columns = useMemo<TableColumn<ProductAttachmentDto>[]>(() => {
    const editing = (a: ProductAttachmentDto) => a.id === editingId;
    return [
      {
        key: "title",
        header: t.subject,
        kind: "text",
        width: 220,
        render: (a) =>
          editing(a) ? (
            <Input
              value={draft.title}
              maxLength={255}
              required
              aria-label={t.subject}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className={CELL_INPUT}
            />
          ) : isPreviewable(a.mime) ? (
            // 押すとポップアップで中身を見せる（PDF・画像・テキスト）。ダウンロードはファイル名から
            <button
              type="button"
              onClick={() => setPreviewing(a)}
              className="text-primary cursor-pointer text-left underline-offset-2 hover:underline"
            >
              {a.title}
            </button>
          ) : (
            a.title
          ),
      },
      {
        key: "kind",
        header: t.kind,
        kind: "enum",
        width: 120,
        options: kinds.map((k) => ({ value: k, label: k })),
        render: (a) =>
          editing(a) ? (
            <select
              aria-label={t.kind}
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
              className="border-input bg-background h-7 w-full rounded-none border px-1 text-sm"
            >
              <option value="" />
              {kindChoices(a.kind).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          ) : (
            a.kind
          ),
      },
      {
        key: "description",
        header: t.description,
        kind: "text",
        width: 260,
        multiline: true,
        clampLines: 3,
        render: (a) =>
          editing(a) ? (
            <Input
              value={draft.description}
              maxLength={2000}
              aria-label={t.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            a.description
          ),
      },
      {
        key: "fileName",
        header: t.fileName,
        kind: "text",
        width: 220,
        render: (a) =>
          a.id === NEW_ID ? (
            // 追加中の行は「＋」で選んだファイル。選び直すときはキャンセルして「＋」からやり直す
            <span className="flex min-w-0 items-center gap-1.5 text-sm">
              <Paperclip className="text-muted-foreground size-3.5 shrink-0" />
              <span className="truncate">{file?.name}</span>
            </span>
          ) : (
            <a
              href={`${base}/${a.id}/file`}
              title={t.download}
              className="text-primary underline-offset-2 hover:underline"
            >
              {a.fileName}
            </a>
          ),
      },
      {
        key: "size",
        header: t.size,
        kind: "number",
        width: 90,
        filterable: false,
        className: "text-right tabular-nums",
        render: (a) => (a.id === NEW_ID ? (file ? formatSize(file.size) : "") : formatSize(a.size)),
      },
      {
        key: "createdBy",
        header: t.createdBy,
        kind: "text",
        width: 120,
        sortable: false,
        filterable: false,
        render: (a) => a.createdByName ?? "",
      },
    ];
  }, [t, editingId, draft, file, base, kinds, kindChoices]);

  const { state, setState, ready } = useTableState(
    "chem.table.productAttachments",
    columns,
    DEFAULT_STATE,
  );
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    const res = await fetch(`${base}?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<ProductAttachmentDto>);
  }, [base, query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /** 「＋」: まずファイルを選ばせる。行を作るのは選んだとき（`onFileChosen`） */
  function chooseFile() {
    setError(null);
    fileInput.current?.click();
  }

  /** ファイルが選ばれたら、表の先頭に行を作って件名などを待つ。選ぶのをやめたときは呼ばれない */
  function onFileChosen(chosen: File) {
    setDraft(EMPTY);
    setOriginal(EMPTY);
    setFile(chosen);
    setEditingId(NEW_ID);
  }

  function startEdit(a: ProductAttachmentDto) {
    setError(null);
    const d = { title: a.title, kind: a.kind ?? "", description: a.description ?? "" };
    setDraft(d);
    setOriginal(d);
    setEditingId(a.id);
  }

  function stopEdit() {
    setEditingId(null);
    setDraft(EMPTY);
    setFile(null);
  }

  async function save() {
    setError(null);
    const creating = editingId === NEW_ID;
    // 件名とファイルは必須（2026-09-27 指示）。件名に既定の値は入れない
    if (draft.title.trim() === "") {
      setError(t.titleRequired);
      return;
    }
    if (creating && !file) {
      setError(t.fileRequired);
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      if (creating && file) {
        const form = new FormData();
        form.append("file", file);
        form.append("title", draft.title);
        form.append("kind", draft.kind);
        form.append("description", draft.description);
        res = await fetch(base, { method: "POST", body: form });
      } else {
        res = await fetch(`${base}/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            kind: draft.kind || null,
            description: draft.description || null,
          }),
        });
      }
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      stopEdit();
      void load();
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通の表が出す */
  async function onDeleteSelected(targets: ProductAttachmentDto[]) {
    setError(null);
    for (const a of targets) {
      const res = await fetch(`${base}/${a.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === a.id) stopEdit();
    }
    void load();
  }

  const items = data?.items ?? null;
  const rows = items === null ? null : editingId === NEW_ID ? [NEW_ROW, ...items] : items;
  const accept = attachmentAccept(extensions, allowMacros);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t.title}
          {data && data.total > 0 && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{data.total}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={accept || undefined}
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            e.target.value = "";
            if (chosen) onFileChosen(chosen);
          }}
        />
        <DataTable
          storageKey="chem.table.productAttachments"
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          total={data?.total ?? 0}
          state={state}
          defaultState={DEFAULT_STATE}
          onStateChange={setState}
          emptyMessage={t.empty}
          selectable={canEdit}
          onDeleteSelected={onDeleteSelected}
          create={canEdit && !editingId ? { onClick: chooseFile } : undefined}
          headerActions={
            canEdit && editingId ? (
              <div className="flex gap-2">
                <Button size="sm" disabled={saving} onClick={() => void save()}>
                  {saving ? m.common.saving : m.common.save}
                </Button>
                <Button size="sm" variant="outline" onClick={stopEdit}>
                  {m.common.cancel}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(original)}>
                  {m.common.clear}
                </Button>
              </div>
            ) : undefined
          }
          // 行を直すのは右端の鉛筆から。直している間は押せなくする（打ちかけを捨てないため）
          rowAction={
            canEdit ? { onClick: startEdit, disabled: () => editingId !== null } : undefined
          }
        />
        {previewing && (
          <AttachmentPreview
            url={`${base}/${previewing.id}/file`}
            attachment={previewing}
            onClose={() => setPreviewing(null)}
          />
        )}
        {/* 足すときだけ、受け付ける形式と上限を出す（共通の表の案内欄はページ送りと場所を分け合うので使わない） */}
        {editingId === NEW_ID && (
          <p className="text-muted-foreground text-xs">{t.hint(maxMb, allowMacros, extensions)}</p>
        )}
      </CardContent>
    </Card>
  );
}
