"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { PeriodicTable } from "@/components/periodic-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ElementDto, ListResponse } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "atomicNumber", direction: "asc" }]);

/** 追加中の行を指す仮の記号。まだ保存されていないので実在しない */
const NEW_ID = "__new__";

interface Draft {
  symbol: string;
  atomicNumber: string;
  nameJa: string;
  nameEn: string;
}
const EMPTY: Draft = { symbol: "", atomicNumber: "", nameJa: "", nameEn: "" };

/** 表の中の入力欄。行の高さを変えないよう小さめにする */
const CELL_INPUT = "h-7 w-full text-sm";

/**
 * 元素。法文物質名の「換算先」で選ぶ一覧。
 *
 * キーは元素記号。換算係数の表が記号で持っているので、そのまま突き合わせられる。
 * 並びは元素番号の昇順。シアン（CN）のように元素でないものは900番台なので末尾に来る。
 */
export function ElementSection() {
  const { m } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  /** 編集中の行（元素記号）。NEW_ID なら追加中 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** 「クリア」で戻す先。編集を始めたときの値 */
  const [original, setOriginal] = useState<Draft>(EMPTY);

  const [data, setData] = useState<ListResponse<ElementDto> | null>(null);
  /** 表を書き換えたら周期表も引き直す */
  const [token, setToken] = useState(0);
  /** 表と周期表で共有する「いま見ている元素」。片方で選ぶともう片方が光る */
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<ElementDto>[]>(() => {
    const editing = (e: ElementDto) => e.symbol === editingId;
    return [
      {
        key: "symbol",
        header: m.elements.symbol,
        kind: "text",
        width: 60,
        className: "font-mono",
        render: (e) =>
          // 記号はキーなので、既にある行では変えられない（換算係数が結び付いているため）
          editing(e) && editingId === NEW_ID ? (
            <Input
              value={draft.symbol}
              maxLength={4}
              aria-label={m.elements.symbol}
              onChange={(e2) => setDraft({ ...draft, symbol: e2.target.value })}
              className={CELL_INPUT + " font-mono"}
              placeholder="Zn"
            />
          ) : (
            e.symbol
          ),
      },
      {
        key: "atomicNumber",
        header: m.elements.atomicNumber,
        kind: "number",
        width: 60,
        className: "text-right font-mono",
        render: (e) =>
          editing(e) ? (
            <Input
              type="number"
              min={1}
              max={999}
              value={draft.atomicNumber}
              aria-label={m.elements.atomicNumber}
              onChange={(e2) => setDraft({ ...draft, atomicNumber: e2.target.value })}
              className={CELL_INPUT + " text-right"}
            />
          ) : (
            e.atomicNumber
          ),
      },
      {
        key: "nameJa",
        header: m.elements.nameJa,
        kind: "text",
        width: 146,
        render: (e) =>
          editing(e) ? (
            <Input
              value={draft.nameJa}
              maxLength={100}
              aria-label={m.elements.nameJa}
              onChange={(e2) => setDraft({ ...draft, nameJa: e2.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            e.nameJa
          ),
      },
      {
        key: "nameEn",
        header: m.elements.nameEn,
        kind: "text",
        width: 132,
        className: "text-muted-foreground",
        render: (e) =>
          editing(e) ? (
            <Input
              value={draft.nameEn}
              maxLength={100}
              aria-label={m.elements.nameEn}
              onChange={(e2) => setDraft({ ...draft, nameEn: e2.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            e.nameEn
          ),
      },
    ];
  }, [m, editingId, draft]);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.elements",
    columns,
    DEFAULT_STATE,
  );

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/elements?" + query);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<ElementDto>);
    setToken((v) => v + 1);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  function startNew() {
    setError(null);
    setDraft(EMPTY);
    setOriginal(EMPTY);
    setEditingId(NEW_ID);
  }

  function startEdit(e: ElementDto) {
    setError(null);
    const d = {
      symbol: e.symbol,
      atomicNumber: String(e.atomicNumber),
      nameJa: e.nameJa,
      nameEn: e.nameEn,
    };
    setDraft(d);
    setOriginal(d);
    setEditingId(e.symbol);
  }

  function stopEdit() {
    setEditingId(null);
    setDraft(EMPTY);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const creating = editingId === NEW_ID;
      const res = await fetch(creating ? "/api/elements" : "/api/elements/" + editingId, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: creating ? draft.symbol : editingId,
          atomicNumber: Number(draft.atomicNumber) || 0,
          nameJa: draft.nameJa,
          nameEn: draft.nameEn,
        }),
      });
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

  /** 確認は共通テーブル側で出す。換算係数から使われているものはサーバーが 409 で断る */
  async function onDeleteSelected(targets: ElementDto[]) {
    setError(null);
    for (const e of targets) {
      const res = await fetch("/api/elements/" + e.symbol, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === e.symbol) stopEdit();
    }
    void load();
  }

  // 追加中は、まだ保存していない空の行を先頭に見せる
  const items = data?.items ?? null;
  const rows =
    items === null
      ? null
      : editingId === NEW_ID
        ? [{ symbol: NEW_ID, atomicNumber: 0, nameJa: "", nameEn: "" }, ...items]
        : items;

  return (
    <div className="w-full space-y-6 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{m.elements.title}</h1>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 表は左、周期表は右。横幅が足りなければ上下に折り返す */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="w-full shrink-0 space-y-4 lg:max-w-[470px]">
          <DataTable
            storageKey="chem.table.elements"
            columns={columns}
            rows={rows}
            rowKey={(e) => e.symbol}
            total={data?.total ?? 0}
            state={state}
            defaultState={DEFAULT_STATE}
            onStateChange={setState}
            onReset={reset}
            emptyMessage={m.elements.empty}
            selectable={editable}
            onDeleteSelected={onDeleteSelected}
            selectedKey={picked}
            onRowSelect={(e) => setPicked(e.symbol)}
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
        </div>

        <div className="min-w-0 flex-1">
          <PeriodicTable reloadToken={token} selected={picked} onSelect={setPicked} />
        </div>
      </div>
    </div>
  );
}
