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
import type { ApiError, CountryDto, ListResponse, RegionDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/** 追加中の行を指す仮のid。まだ保存されていないので実在しない */
const NEW_ID = "__new__";

interface Draft {
  code: string;
  regionId: string;
  nameJa: string;
  nameEn: string;
  displayOrder: number;
}
const EMPTY: Draft = { code: "", regionId: "", nameJa: "", nameEn: "", displayOrder: 0 };

const toDraft = (c: CountryDto): Draft => ({
  code: c.code,
  regionId: c.regionId,
  nameJa: c.nameJa,
  nameEn: c.nameEn ?? "",
  displayOrder: c.displayOrder,
});

/** 表の中の入力欄。行の高さを変えないよう小さめにする */
const CELL_INPUT = "h-7 w-full text-sm";
const CELL_SELECT = "border-input bg-background h-7 w-full rounded-md border px-1 text-sm";

/**
 * 国。法令の持ち主になる単位で、地域の配下に置く。
 * 地域と同じ画面に並べ、地域と同じく**表の行のまま**書き換える。
 *
 * `regionsVersion` は地域の側で追加・削除が起きたときに増える。選択肢を引き直す合図に使う。
 */
export function CountrySection({ regionsVersion }: { regionsVersion: number }) {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [regions, setRegions] = useState<RegionDto[]>([]);

  /** 編集中の行。NEW_ID なら追加中 */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** 「クリア」で戻す先。編集を始めたときの値 */
  const [original, setOriginal] = useState<Draft>(EMPTY);

  const [data, setData] = useState<ListResponse<CountryDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<CountryDto>[]>(() => {
    const editing = (c: CountryDto) => c.id === editingId;
    return [
      {
        key: "code",
        header: m.countries.code,
        kind: "text",
        width: 90,
        className: "font-mono",
        render: (c) =>
          editing(c) ? (
            <Input
              value={draft.code}
              maxLength={20}
              aria-label={m.countries.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              className={`${CELL_INPUT} font-mono`}
            />
          ) : (
            c.code
          ),
      },
      {
        key: "nameJa",
        header: m.countries.nameJa,
        kind: "text",
        width: 130,
        render: (c) =>
          editing(c) ? (
            <Input
              value={draft.nameJa}
              maxLength={200}
              aria-label={m.countries.nameJa}
              onChange={(e) => setDraft({ ...draft, nameJa: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            pickName(locale, c.nameJa, c.nameEn)
          ),
      },
      {
        key: "nameEn",
        header: m.countries.nameEn,
        kind: "text",
        width: 130,
        className: "text-muted-foreground",
        render: (c) =>
          editing(c) ? (
            <Input
              value={draft.nameEn}
              maxLength={200}
              aria-label={m.countries.nameEn}
              onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
              className={CELL_INPUT}
            />
          ) : (
            (c.nameEn ?? "")
          ),
      },
      {
        // 絞り込みは地域のIDで送る。選択肢は登録済みの地域から作る
        key: "regionId",
        header: m.countries.region,
        kind: "enum",
        width: 110,
        options: regions.map((r) => ({
          value: r.id,
          label: pickName(locale, r.nameJa, r.nameEn),
        })),
        render: (c) =>
          editing(c) ? (
            <select
              value={draft.regionId}
              aria-label={m.countries.region}
              onChange={(e) => setDraft({ ...draft, regionId: e.target.value })}
              className={CELL_SELECT}
            >
              <option value="" disabled>
                —
              </option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {pickName(locale, r.nameJa, r.nameEn)}
                </option>
              ))}
            </select>
          ) : (
            pickName(locale, c.regionNameJa, c.regionNameEn)
          ),
      },
      {
        key: "displayOrder",
        header: m.countries.displayOrder,
        kind: "number",
        width: 60,
        className: "text-muted-foreground text-right",
        render: (c) =>
          editing(c) ? (
            <Input
              type="number"
              min={0}
              max={9999}
              value={draft.displayOrder}
              aria-label={m.countries.displayOrder}
              onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) })}
              className={`${CELL_INPUT} text-right`}
            />
          ) : (
            c.displayOrder
          ),
      },
    ];
  }, [m, locale, regions, editingId, draft]);

  const { state, setState, reset, ready } = useTableState(
    "chem.table.countries",
    columns,
    DEFAULT_STATE,
  );

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/countries?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<CountryDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // 地域は選択肢に使うだけなので、並べ替えや絞り込みは付けずに全件引く
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/regions?size=200").catch(() => null);
      if (!res || !res.ok || !alive) return;
      const body = (await res.json()) as ListResponse<RegionDto>;
      if (alive) setRegions(body.items);
    })();
    return () => {
      alive = false;
    };
  }, [regionsVersion]);

  function startNew() {
    setError(null);
    setWarnings([]);
    // 地域が1つだけなら選んでおく（選び直す手間を省く）
    const start = { ...EMPTY, regionId: regions.length === 1 ? (regions[0]?.id ?? "") : "" };
    setDraft(start);
    setOriginal(start);
    setEditingId(NEW_ID);
  }

  function startEdit(c: CountryDto) {
    setError(null);
    setWarnings([]);
    const d = toDraft(c);
    setDraft(d);
    setOriginal(d);
    setEditingId(c.id);
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
      const res = await fetch(creating ? "/api/countries" : `/api/countries/${editingId}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code,
          regionId: draft.regionId,
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
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す。法令から使われているものはサーバーが 409 で断る */
  async function onDeleteSelected(targets: CountryDto[]) {
    setError(null);
    for (const c of targets) {
      const res = await fetch(`/api/countries/${c.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (editingId === c.id) stopEdit();
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
              code: "",
              regionId: "",
              regionNameJa: "",
              regionNameEn: null,
              nameJa: "",
              nameEn: null,
              displayOrder: 0,
            },
            ...items,
          ]
        : items;

  return (
    <section className="max-w-2xl space-y-3">
      <h2 className="text-lg font-semibold">{m.countries.title}</h2>

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
        storageKey="chem.table.countries"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={regions.length === 0 ? m.countries.noRegion : m.countries.empty}
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
              // 地域が1件も無いと国は作れない
              <Button size="sm" disabled={regions.length === 0} onClick={startNew}>
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
