"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { VersionSourcePicker, type VersionSource } from "@/components/version-source-picker";
import type { ApiError, InventoryDto, InventoryRowDto, ListResponse } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "casNumber", direction: "asc" }]);

/** 追加中の行を指す仮の記号。まだ保存されていないので実在しない */
const NEW_ID = "__new__";

interface Draft {
  sourceId: string;
  casNumber: string;
  value: string;
}
const EMPTY: Draft = { sourceId: "", casNumber: "", value: "" };

const CELL_INPUT = "h-7 w-full text-sm";

/**
 * インベントリの該当物質（CASと番号の対応）。
 *
 * **現在のバージョンのぶんだけを扱う。**過去のバージョンは取り込んだ姿のまま残す。
 * 後から書き換えると、そのバージョンで出した判定の跡と食い違うため。
 *
 * 同じCASが複数のデータソースから来ていることがある。どれが採られるかは
 * バージョンごとの優先度で決まるので、「採用」の欄でそれを見せる。
 */
export function InventoryRowsSection({ inventoryId }: { inventoryId: string }) {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [inventory, setInventory] = useState<InventoryDto | null>(null);
  /** 表の上のプルダウンで選んでいる組。決まるまでは引かない */
  const [picked, setPicked] = useState<VersionSource | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [original, setOriginal] = useState<Draft>(EMPTY);

  const [data, setData] = useState<ListResponse<InventoryRowDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<InventoryRowDto>[]>(() => {
    const editing = (r: InventoryRowDto) => r.id === editingId;
    return [
      {
        key: "casNumber",
        header: m.inventories.casNumber,
        kind: "text",
        width: 140,
        className: "font-mono",
        render: (r) =>
          editing(r) ? (
            <Input
              value={draft.casNumber}
              maxLength={20}
              aria-label={m.inventories.casNumber}
              onChange={(e) => setDraft({ ...draft, casNumber: e.target.value })}
              className={CELL_INPUT + " font-mono"}
            />
          ) : (
            r.casNumber
          ),
      },
      {
        key: "value",
        header: m.inventories.value,
        kind: "text",
        width: 200,
        className: "font-mono",
        render: (r) =>
          editing(r) ? (
            <Input
              value={draft.value}
              maxLength={200}
              aria-label={m.inventories.value}
              onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              className={CELL_INPUT + " font-mono"}
            />
          ) : (
            r.value
          ),
      },
      {
        key: "used",
        header: m.inventories.used,
        kind: "enum",
        width: 80,
        className: "text-center",
        sortable: false,
        filterable: false,
        render: (r) =>
          r.used ? (
            <span title={m.inventories.usedYes}>○</span>
          ) : (
            <span className="text-muted-foreground" title={m.inventories.usedNo}>
              —
            </span>
          ),
      },
      {
        key: "matchedSubstance",
        header: m.inventories.matchedSubstance,
        kind: "text",
        width: 260,
        sortable: false,
        filterable: false,
        render: (r) =>
          r.matchedSubstance ? (
            <Link
              href={`/substances/${r.matchedSubstance.id}`}
              className="text-xs underline underline-offset-2"
            >
              {r.matchedSubstance.code}:{" "}
              {pickName(locale, r.matchedSubstance.nameJa, r.matchedSubstance.nameEn)}
            </Link>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          ),
      },
      {
        key: "updatedAt",
        header: m.news.updatedAt,
        kind: "date",
        nullable: false,
        width: 120,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ];
  }, [m, locale, editingId, draft]);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.inventoryRows",
    columns,
    DEFAULT_STATE,
  );

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    if (!picked?.versionId) return;
    setError(null);
    const params = new URLSearchParams(query);
    params.set("versionId", picked.versionId);
    if (picked.sourceId) params.set("sourceId", picked.sourceId);
    const res = await fetch(`/api/inventories/${inventoryId}/rows?${params.toString()}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<InventoryRowDto>);
  }, [inventoryId, query, m, picked]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  useEffect(() => {
    // 見出しに名前を出すためだけに引く。中身とは別の問い合わせ
    void (async () => {
      const res = await fetch(`/api/inventories/${inventoryId}`).catch(() => null);
      if (res?.ok) setInventory(((await res.json()) as { item: InventoryDto }).item);
    })();
  }, [inventoryId]);

  function startNew() {
    setError(null);
    setWarnings([]);
    // 入る先は、いま選んでいるバージョンとデータソース
    const d: Draft = { ...EMPTY, sourceId: picked?.sourceId ?? "" };
    setDraft(d);
    setOriginal(d);
    setEditingId(NEW_ID);
  }

  function startEdit(r: InventoryRowDto) {
    setError(null);
    setWarnings([]);
    const d: Draft = { sourceId: r.sourceId, casNumber: r.casNumber, value: r.value };
    setDraft(d);
    setOriginal(d);
    setEditingId(r.id);
  }

  function stopEdit() {
    setEditingId(null);
    setDraft(EMPTY);
  }

  async function save() {
    if (!editingId) return;
    setError(null);
    setWarnings([]);
    setSaving(true);
    try {
      const creating = editingId === NEW_ID;
      const q = picked?.versionId ? `?versionId=${picked.versionId}` : "";
      const res = await fetch(
        creating
          ? `/api/inventories/${inventoryId}/rows${q}`
          : `/api/inventories/${inventoryId}/rows/${editingId}${q}`,
        {
          method: creating ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // データソースは表の上で選んだもの。行ごとには持たせない
            sourceId: picked?.sourceId ?? draft.sourceId,
            casNumber: draft.casNumber,
            value: draft.value,
          }),
        },
      );
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
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す。ここは消す処理だけ */
  async function onDeleteSelected(targets: InventoryRowDto[]) {
    setError(null);
    for (const r of targets) {
      const q = picked?.versionId ? `?versionId=${picked.versionId}` : "";
      const res = await fetch(`/api/inventories/${inventoryId}/rows/${r.id}${q}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === r.id) stopEdit();
    }
    void load();
  }

  // 追加中は、まだ保存していない空の行を先頭に見せる
  const items = data?.items ?? null;
  const rows =
    items === null
      ? null
      : editingId === NEW_ID
        ? [
            {
              id: NEW_ID,
              sourceId: picked?.sourceId ?? "",
              sourceCode: "",
              used: false,
              casNumber: "",
              value: "",
              updatedAt: new Date().toISOString(),
              matchedSubstance: null,
            } satisfies InventoryRowDto,
            ...items,
          ]
        : items;

  const name = inventory
    ? (pickName(locale, inventory.nameJa, inventory.nameEn) ?? inventory.code)
    : "";

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      {/* いまどこにいるか。メニューの項目名から始める */}
      <Breadcrumbs
        items={[
          { label: m.nav.laws },
          { label: m.inventories.title, href: "/inventories" },
          { label: name || m.common.loading },
        ]}
      />
      <h1 className="text-2xl font-semibold">
        {name ? m.inventories.rowsTitle(name) : m.common.loading}
      </h1>
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
        storageKey="chem.table.inventoryRows"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.inventories.rowsEmpty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        // データソースが決まらないと、足しても入れる先がない
        create={editable && !editingId && picked?.sourceId ? { onClick: startNew } : undefined}
        headerActions={
          <div className="flex flex-wrap items-center gap-2">
            {editable && editingId && (
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
            )}
            {/* 対象CASの画面と同じ並び・同じ順（バージョン → データソース） */}
            <VersionSourcePicker
              value={picked}
              onChange={setPicked}
              hint={m.inventories.usedHint}
            />
          </div>
        }
        rowAction={
          editable ? { onClick: startEdit, disabled: () => editingId !== null } : undefined
        }
      />
      <p className="text-muted-foreground text-xs">{m.inventories.deleteNote}</p>
    </div>
  );
}
