"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse, RegionDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** 追加中の行を指す仮のid。まだ保存されていないので実在しない */
const NEW_ID = "__new__";

interface Draft {
  code: string;
  nameJa: string;
  nameEn: string;
  displayOrder: number;
}
const EMPTY: Draft = { code: "", nameJa: "", nameEn: "", displayOrder: 0 };

const toDraft = (r: RegionDto): Draft => ({
  code: r.code,
  nameJa: r.nameJa,
  nameEn: r.nameEn ?? "",
  displayOrder: r.displayOrder,
});

/** 表の中の入力欄。行の高さを変えないよう小さめにする */
const CELL_INPUT = "h-7 w-full text-sm";

/**
 * 地域（アジア・欧州など、国より大きいまとまり）。国はここには入れない。
 *
 * 項目が少なく件数も多くないので、別のフォームを開かずに**表の行のまま**書き換える。
 * 「＋ 新規登録」で空の行が先頭に増え、行をダブルクリックするとその行が入力欄に変わる。
 */
export function RegionSection({ onChanged }: { onChanged?: () => void }) {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  /** 編集中の行。NEW_ID なら追加中 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** 「クリア」で戻す先。編集を始めたときの値 */
  const [original, setOriginal] = useState<Draft>(EMPTY);

  const [data, setData] = useState<ListResponse<RegionDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<RegionDto>[]>(() => {
    const editing = (r: RegionDto) => r.id === editingId;
    return [
      {
        key: "code",
        header: m.regions.code,
        kind: "text",
        width: 90,
        className: "font-mono",
        render: (r) =>
          editing(r) ? (
            <Input
              value={draft.code}
              maxLength={20}
              aria-label={m.regions.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              className={`${CELL_INPUT} font-mono`}
            />
          ) : (
            r.code
          ),
      },
      {
        key: "nameJa",
        header: m.regions.nameJa,
        kind: "text",
        width: 130,
        render: (r) =>
          editing(r) ? (
            <Input
              value={draft.nameJa}
              maxLength={200}
              aria-label={m.regions.nameJa}
              onChange={(e) => setDraft({ ...draft, nameJa: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            pickName(locale, r.nameJa, r.nameEn)
          ),
      },
      {
        key: "nameEn",
        header: m.regions.nameEn,
        kind: "text",
        width: 130,
        className: "text-muted-foreground",
        render: (r) =>
          editing(r) ? (
            <Input
              value={draft.nameEn}
              maxLength={200}
              aria-label={m.regions.nameEn}
              onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            (r.nameEn ?? "")
          ),
      },
      {
        key: "displayOrder",
        header: m.regions.displayOrder,
        kind: "number",
        width: 60,
        className: "text-muted-foreground text-right",
        render: (r) =>
          editing(r) ? (
            <Input
              type="number"
              min={0}
              max={9999}
              value={draft.displayOrder}
              aria-label={m.regions.displayOrder}
              onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) })}
              className={`${CELL_INPUT} text-right`}
            />
          ) : (
            r.displayOrder
          ),
      },
    ];
  }, [m, locale, editingId, draft]);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.regions",
    columns,
    DEFAULT_STATE,
  );

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/regions?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<RegionDto>);
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

  function startEdit(r: RegionDto) {
    setError(null);
    setWarnings([]);
    const d = toDraft(r);
    setDraft(d);
    setOriginal(d);
    setEditingId(r.id);
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
      const res = await fetch(creating ? "/api/regions" : `/api/regions/${editingId}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code,
          nameJa: draft.nameJa,
          nameEn: draft.nameEn || null,
          displayOrder: Number(draft.displayOrder) || 0,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const body = (await res.json()) as { warnings?: string[] };
      setWarnings(body.warnings ?? []);
      stopEdit();
      void load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す。国や法令から使われているものはサーバーが 409 で断る */
  async function onDeleteSelected(targets: RegionDto[]) {
    setError(null);
    for (const r of targets) {
      const res = await fetch(`/api/regions/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === r.id) stopEdit();
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
        ? [{ id: NEW_ID, code: "", nameJa: "", nameEn: null, displayOrder: 0 }, ...items]
        : items;

  return (
    <section className="max-w-2xl space-y-3">
      <h2 className="text-lg font-semibold">{m.regions.title}</h2>

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
        storageKey="chem.table.regions"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.regions.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        // 件数が少ないので絞り込みは出さない（並べ替えは見出しで行う）
        showFilters={false}
        // 案内の文言は出さない（この表では「詳細」ではなく編集を開くため）
        showOpenHint={false}
        // その場で入力欄に変わるだけなので、待ち時間の表示は要らない
        busyOnActivate={false}
        headerActions={
          editable ? (
            editingId ? (
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
            ) : (
              <Button size="sm" onClick={startNew}>
                {m.common.create}
              </Button>
            )
          ) : undefined
        }
        // 編集中は他の行に移らない（打ちかけの内容を黙って捨てないため）
        onRowActivate={editable && !editingId ? startEdit : undefined}
      />
    </section>
  );
}
