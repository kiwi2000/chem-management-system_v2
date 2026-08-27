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
import type { ApiError, CountryDto, InventoryDto, ListResponse } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

/** 既定の並びは、物質の画面に出す順。設定した並びをそのまま確かめられる */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "numberOrder", direction: "asc" }]);

interface Draft {
  nameJa: string;
  nameEn: string;
  numberLabel: string;
  numberOrder: string;
  numberShown: boolean;
}
const EMPTY: Draft = {
  nameJa: "",
  nameEn: "",
  numberLabel: "",
  numberOrder: "0",
  numberShown: false,
};

/** 表の中の入力欄。行の高さを変えないよう小さめにする */
const CELL_INPUT = "h-7 w-full text-sm";

/**
 * インベントリ（各国の既存化学物質の目録）の一覧。
 *
 * **足したり消したりはしない。**インベントリそのものは取り込みが作るもので、
 * 画面から作ると次の取り込みと結び付かなくなる。ここで直すのは
 * **名前と、番号としての出しかた**だけ。該当物質は別の画面で見る。
 */
export function InventorySection() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** 「クリア」で戻す先。編集を始めたときの値 */
  const [original, setOriginal] = useState<Draft>(EMPTY);

  const [data, setData] = useState<ListResponse<InventoryDto> | null>(null);
  /** 国の絞り込みの選択肢。打たせずに選ばせるため */
  const [countries, setCountries] = useState<CountryDto[]>([]);
  const [version, setVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<InventoryDto>[]>(() => {
    const editing = (i: InventoryDto) => i.id === editingId;
    return [
      {
        key: "code",
        header: m.inventories.code,
        kind: "text",
        width: 110,
        className: "font-mono",
        render: (i) => (
          // 該当物質を見に行く入口。コードは取り込みが決めるので、ここでは直せない
          <Link href={`/inventories/${i.id}`} className="underline underline-offset-2">
            {i.code}
          </Link>
        ),
      },
      {
        // 国は決まった集合なので、打たせずに選ばせる（複数選べる）
        key: "countryId",
        header: m.inventories.country,
        kind: "enum",
        options: countries.map((c) => ({
          value: c.id,
          label: pickName(locale, c.nameJa, c.nameEn),
        })),
        width: 110,
        sortable: false,
        render: (i) => pickName(locale, i.countryNameJa, i.countryNameEn),
      },
      {
        key: "nameJa",
        header: m.inventories.nameJa,
        kind: "text",
        width: 220,
        render: (i) =>
          editing(i) ? (
            <Input
              value={draft.nameJa}
              maxLength={200}
              aria-label={m.inventories.nameJa}
              onChange={(e) => setDraft({ ...draft, nameJa: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            (i.nameJa ?? i.nameOriginal)
          ),
      },
      {
        key: "nameEn",
        header: m.inventories.nameEn,
        kind: "text",
        width: 190,
        className: "text-muted-foreground",
        render: (i) =>
          editing(i) ? (
            <Input
              value={draft.nameEn}
              maxLength={200}
              aria-label={m.inventories.nameEn}
              onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            i.nameEn
          ),
      },
      {
        key: "numberLabel",
        header: m.inventories.numberLabel,
        kind: "text",
        // 呼び名は物質の画面の見出しになる。長いものがあるので広めに取る
        width: 230,
        render: (i) =>
          editing(i) ? (
            <Input
              value={draft.numberLabel}
              maxLength={100}
              aria-label={m.inventories.numberLabel}
              onChange={(e) => setDraft({ ...draft, numberLabel: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            (i.numberLabel ?? <span className="text-muted-foreground">—</span>)
          ),
      },
      {
        key: "numberShown",
        header: m.inventories.numberShown,
        kind: "enum",
        options: [
          { value: "true", label: m.common.yes },
          { value: "false", label: m.common.no },
        ],
        width: 100,
        className: "text-center",
        render: (i) =>
          editing(i) ? (
            <input
              type="checkbox"
              checked={draft.numberShown}
              aria-label={m.inventories.numberShown}
              onChange={(e) => setDraft({ ...draft, numberShown: e.target.checked })}
            />
          ) : i.numberShown ? (
            "○"
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "numberOrder",
        header: m.inventories.numberOrder,
        kind: "number",
        width: 70,
        className: "text-right font-mono",
        render: (i) =>
          editing(i) ? (
            <Input
              type="number"
              min={0}
              max={9999}
              value={draft.numberOrder}
              aria-label={m.inventories.numberOrder}
              onChange={(e) => setDraft({ ...draft, numberOrder: e.target.value })}
              className={CELL_INPUT + " text-right"}
            />
          ) : (
            i.numberOrder
          ),
      },
      {
        key: "rowCount",
        header: m.inventories.rowCount,
        kind: "number",
        width: 100,
        className: "text-right font-mono",
        // 現在のバージョンのぶんを数えたもの。並べ替えも絞り込みもできない
        sortable: false,
        filterable: false,
        render: (i) => i.rowCount.toLocaleString(locale),
      },
    ];
  }, [m, locale, editingId, draft, countries]);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.inventories",
    columns,
    DEFAULT_STATE,
  );

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/inventories?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    const body = (await res.json()) as ListResponse<InventoryDto> & {
      version: { code: string } | null;
    };
    setData(body);
    setVersion(body.version?.code ?? null);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  useEffect(() => {
    // 国は多くないので1ページで全部引く
    void (async () => {
      const res = await fetch("/api/countries?size=200").catch(() => null);
      if (res?.ok) setCountries(((await res.json()) as ListResponse<CountryDto>).items);
    })();
  }, []);

  function startEdit(i: InventoryDto) {
    setError(null);
    const d: Draft = {
      nameJa: i.nameJa ?? "",
      nameEn: i.nameEn ?? "",
      numberLabel: i.numberLabel ?? "",
      numberOrder: String(i.numberOrder),
      numberShown: i.numberShown,
    };
    setDraft(d);
    setOriginal(d);
    setEditingId(i.id);
  }

  function stopEdit() {
    setEditingId(null);
    setDraft(EMPTY);
  }

  async function save() {
    if (!editingId) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/inventories/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameJa: draft.nameJa || null,
          nameEn: draft.nameEn || null,
          numberLabel: draft.numberLabel || null,
          numberOrder: Number(draft.numberOrder) || 0,
          numberShown: draft.numberShown,
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

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{m.inventories.title}</h1>
      <p className="text-muted-foreground text-sm">{m.inventories.description}</p>
      {/*
        どのバージョンを見ているかは常に出す。バージョンが違えば件数も中身も変わる。
        ただし引き終わるまでは何も言わない（読み込み中と、バージョンが無いのを混同させない）
      */}
      {data !== null && (
        <p className="text-muted-foreground text-xs">
          {version ? m.inventories.versionNote(version) : m.inventories.noCurrentVersion}
        </p>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        storageKey="chem.table.inventories"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(i) => i.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.inventories.empty}
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
        // 直すのは行の右端の鉛筆から。編集中は押せなくする（打ちかけの内容を捨てないため）
        rowAction={
          editable ? { onClick: startEdit, disabled: () => editingId !== null } : undefined
        }
      />
    </div>
  );
}
