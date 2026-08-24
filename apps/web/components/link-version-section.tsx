"use client";

import { emptyTableState, serializeTableState, type TableState } from "@chem/shared";
import { Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, LinkSetVersionDto, ListResponse } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { cn } from "@/lib/utils";
import { useTableState } from "@/lib/use-table-state";

// 件数が知れているので1ページに全部出し、ページ送りは置かない
const DEFAULT_STATE: TableState = {
  ...emptyTableState([{ column: "code", direction: "desc" }]),
  pageSize: 200,
};

/** 追加中の行を指す仮のid。まだ保存されていないので実在しない */
const NEW_ID = "__new__";

/** 表の中の入力欄。行の高さを変えないよう小さめにする */
const CELL_INPUT = "h-7 w-full text-sm";

/**
 * バージョン（いつ時点のデータか）。
 *
 * 登録するのは**コードだけ**。中身はデータソースの側に付く。
 * 作っただけでは切り替わらないので、使うものは「現在のバージョンにする」で明示的に決める。
 */
export function LinkVersionSection({
  selectedId,
  onSelect,
  onChanged,
}: {
  /** 右に出すデータソースを決めるための選択。行を1回押すと移る */
  selectedId: string | null;
  onSelect: (id: string, code: string) => void;
  onChanged?: () => void;
}) {
  const { m } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  /** 「クリア」で戻す先。編集を始めたときの値 */
  const [original, setOriginal] = useState("");
  const [data, setData] = useState<ListResponse<LinkSetVersionDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<LinkSetVersionDto>[]>(
    () => [
      {
        key: "isCurrent",
        header: m.linkVersions.current,
        kind: "enum",
        width: 80,
        className: "text-center",
        options: [
          { value: "true", label: m.common.yes },
          { value: "false", label: m.common.no },
        ],
        // 現在のものだけに印。判定に使われているのが一目で分かるように
        // この欄をそのまま押すと、現在のバージョンがそこへ移る。
        // 塗りつぶし＝利用者が選んだもの、輪郭だけ＝自動で選ばれたもの
        render: (v) => (
          <button
            type="button"
            disabled={!editable || v.isCurrent || v.id === NEW_ID || saving}
            title={
              v.isCurrent
                ? v.currentPinned
                  ? m.linkVersions.currentPinned
                  : m.linkVersions.currentAuto
                : m.linkVersions.makeCurrent
            }
            aria-label={v.isCurrent ? m.linkVersions.current : m.linkVersions.makeCurrent}
            onClick={(e) => {
              e.stopPropagation();
              void makeCurrent(v);
            }}
            className={cn(
              // 欄のどこを押しても切り替わるように、ボタンを欄いっぱいに広げる
              "-my-1 flex h-8 w-full items-center justify-center rounded",
              // まだ現在でない行は薄く出しておく。押せる場所だと分かるように
              !v.isCurrent &&
                "text-muted-foreground/30 enabled:hover:bg-accent enabled:hover:text-foreground",
            )}
          >
            <Star className={cn("size-4", v.isCurrent && v.currentPinned && "fill-current")} />
          </button>
        ),
      },
      {
        key: "code",
        header: m.linkVersions.code,
        kind: "text",
        width: 116,
        className: "font-mono",
        render: (v) =>
          v.id === editingId ? (
            <Input
              value={code}
              maxLength={50}
              aria-label={m.linkVersions.code}
              onChange={(e) => setCode(e.target.value)}
              className={CELL_INPUT + " font-mono"}
              placeholder="V2026-04"
            />
          ) : (
            v.code
          ),
      },
    ],
    // makeCurrent は毎回作り直されるが、押したときに読むだけなので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, editingId, code, editable, saving],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.linkVersions",
    columns,
    DEFAULT_STATE,
  );

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/link-versions?" + query);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<LinkSetVersionDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  /*
    右側が空のままだと何をする画面か分からないので、
    最初の読み込みで現在のバージョンを選んでおく（無ければ先頭）。
  */
  useEffect(() => {
    if (selectedId || !data || data.items.length === 0) return;
    const first = data.items.find((v) => v.isCurrent) ?? data.items[0]!;
    onSelect(first.id, first.code);
  }, [data, selectedId, onSelect]);

  function startNew() {
    setError(null);
    setCode("");
    setOriginal("");
    setEditingId(NEW_ID);
  }

  function startEdit(v: LinkSetVersionDto) {
    setError(null);
    setCode(v.code);
    setOriginal(v.code);
    setEditingId(v.id);
  }

  function stopEdit() {
    setEditingId(null);
    setCode("");
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const creating = editingId === NEW_ID;
      const res = await fetch(creating ? "/api/link-versions" : "/api/link-versions/" + editingId, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      stopEdit();
      void load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  /** 現在のバージョンの切り替え。押したらすぐ移る（押し間違えても押し直せばよい） */
  async function makeCurrent(target: LinkSetVersionDto) {
    if (target.isCurrent) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/link-versions/" + target.id + "/current", { method: "POST" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      void load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す。現在のバージョンはサーバーが 409 で断る */
  async function onDeleteSelected(targets: LinkSetVersionDto[]) {
    setError(null);
    for (const v of targets) {
      const res = await fetch("/api/link-versions/" + v.id, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === v.id) stopEdit();
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
        ? [{ id: NEW_ID, code: "", isCurrent: false, currentPinned: false }, ...items]
        : items;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{m.linkVersions.title}</h2>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.linkVersions"
        columns={columns}
        rows={rows}
        rowKey={(v) => v.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.linkVersions.empty}
        selectable={editable}
        singleSelect
        onDeleteSelected={onDeleteSelected}
        selectedKey={selectedId}
        onRowSelect={(v) => onSelect(v.id, v.code)}
        showPager={false}
        showFilters={false}
        showOpenHint={false}
        busyOnActivate={false}
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
              <Button size="sm" variant="ghost" onClick={() => setCode(original)}>
                {m.common.clear}
              </Button>
            </div>
          ) : undefined
        }
        // 編集中は他の行に移らない（打ちかけの内容を黙って捨てないため）
        onRowActivate={editable && !editingId ? startEdit : undefined}
      />
    </section>
  );
}
