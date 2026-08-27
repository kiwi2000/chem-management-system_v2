"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, SourceDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

// 件数が知れているので1ページに全部出し、ページ送りは置かない
const DEFAULT_STATE: TableState = {
  ...emptyTableState([{ column: "code", direction: "asc" }]),
  pageSize: 200,
};

/** 追加中の行を指す仮のid。まだ保存されていないので実在しない */
const NEW_ID = "__new__";

interface Draft {
  code: string;
  note: string;
}
const EMPTY: Draft = { code: "", note: "" };

const toDraft = (s: SourceDto): Draft => ({ code: s.code, note: s.note ?? "" });

/** 表の中の入力欄。行の高さを変えないよう小さめにする */
const CELL_INPUT = "h-7 w-full text-sm";

/**
 * 情報源（LOLI・CHRIP・自社データなど）。
 *
 * ここは「どんな情報源があるか」だけ。どのバージョンでどの順に読むかはバージョンの側で決める。
 * 件数が少ないので、別のフォームを開かずに表の行のまま書き換える。
 */
export function SourceSection({ onChanged }: { onChanged?: () => void }) {
  const { m } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** 「クリア」で戻す先。編集を始めたときの値 */
  const [original, setOriginal] = useState<Draft>(EMPTY);

  const [data, setData] = useState<ListResponse<SourceDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<SourceDto>[]>(() => {
    const editing = (s: SourceDto) => s.id === editingId;
    return [
      {
        key: "code",
        header: m.sources.code,
        kind: "text",
        width: 100,
        className: "font-mono",
        render: (s) =>
          editing(s) ? (
            <Input
              value={draft.code}
              maxLength={50}
              aria-label={m.sources.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              className={CELL_INPUT + " font-mono"}
            />
          ) : (
            s.code
          ),
      },
      {
        key: "note",
        header: m.sources.note,
        kind: "text",
        width: 220,
        render: (s) =>
          editing(s) ? (
            <Input
              value={draft.note}
              maxLength={2000}
              aria-label={m.sources.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            (s.note ?? "")
          ),
      },
    ];
  }, [m, editingId, draft]);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.sources",
    columns,
    DEFAULT_STATE,
  );

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/sources?" + query);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<SourceDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  function startNew() {
    setError(null);
    setWarnings([]);
    setDraft(EMPTY);
    setOriginal(EMPTY);
    setEditingId(NEW_ID);
  }

  function startEdit(s: SourceDto) {
    setError(null);
    setWarnings([]);
    const d = toDraft(s);
    setDraft(d);
    setOriginal(d);
    setEditingId(s.id);
  }

  function stopEdit() {
    setEditingId(null);
    setDraft(EMPTY);
  }

  async function save() {
    setError(null);
    setWarnings([]);
    setSaving(true);
    try {
      const creating = editingId === NEW_ID;
      const res = await fetch(creating ? "/api/sources" : "/api/sources/" + editingId, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code,
          note: draft.note || null,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { warnings?: string[] };
      setWarnings(body.warnings ?? []);
      stopEdit();
      void load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す。使われているものはサーバーが 409 で断る */
  async function onDeleteSelected(targets: SourceDto[]) {
    setError(null);
    for (const s of targets) {
      const res = await fetch("/api/sources/" + s.id, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === s.id) stopEdit();
    }
    void load();
    onChanged?.();
  }

  // 追加中は、まだ保存していない空の行を先頭に見せる
  const items = data?.items ?? null;
  const rows =
    items === null
      ? null
      : editingId === NEW_ID
        ? [{ id: NEW_ID, code: "", note: null }, ...items]
        : items;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{m.sources.title}</h2>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.sources"
        columns={columns}
        rows={rows}
        rowKey={(s) => s.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.sources.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        showPager={false}
        // 件数が少ないので絞り込みは出さない（並べ替えは見出しで行う）
        showFilters={false}
        create={editable && !editingId ? { onClick: startNew } : undefined}
        headerActions={
          editable && editingId ? (
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
        // 編集は行の右端の鉛筆から。編集中は押せなくする（打ちかけの内容を捨てないため）
        rowAction={
          editable ? { onClick: startEdit, disabled: () => editingId !== null } : undefined
        }
      />
    </section>
  );
}
