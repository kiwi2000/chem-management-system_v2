"use client";

import {
  IMPURITY_NONE,
  emptyTableState,
  pickName,
  pickStatutoryName,
  type TableState,
} from "@chem/shared";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  ImpurityExemptionsDto,
  ImpurityTypeDto,
  LawDto,
  ListResponse,
  RegulationCategoryDto,
  StatutorySubstanceDto,
} from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";
import { cn } from "@/lib/utils";

/**
 * 不純物種別（S21）。
 *
 * 上で種別を選び、下でその種別を「非該当にする規制区分」を決める。
 * 区分の行の「例外」から、法文物質名ごとに区分の設定を上書きできる。
 *
 * **付け外しは 1 回ごとに保存する。**保存ボタンを押し忘れて設定が残らない、を防ぐため。
 * 設定を変えると判定の前提が変わるので、左下に「要再計算」が出る
 */

const EMPTY_FORM = { id: "", code: "", nameJa: "", nameEn: "", note: "" };

/** 件数が知れているので、並びは表示順のみ */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);

export default function ImpurityTypesPage() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [types, setTypes] = useState<ImpurityTypeDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 法律 → 区分。除外の表はこの並びで出す */
  const [laws, setLaws] = useState<LawDto[]>([]);
  const [categories, setCategories] = useState<RegulationCategoryDto[]>([]);
  const [openLaws, setOpenLaws] = useState<Set<string>>(new Set());
  const [exempt, setExempt] = useState<ImpurityExemptionsDto | null>(null);

  /** 例外を開いている区分 */
  const [exceptionsFor, setExceptionsFor] = useState<RegulationCategoryDto | null>(null);

  const selected = types.find((p) => p.id === selectedId) ?? null;

  const columns = useMemo<TableColumn<ImpurityTypeDto>[]>(
    () => [
      {
        key: "code",
        header: m.impurityTypes.code,
        kind: "text",
        width: 96,
        sortable: false,
        filterable: false,
        className: "font-mono text-xs",
        render: (r) => r.code,
      },
      {
        key: "nameJa",
        header: m.impurityTypes.name,
        kind: "text",
        width: 240,
        sortable: false,
        filterable: false,
        render: (r) => (
          <>
            {pickName(locale, r.nameJa, r.nameEn)}
            {r.builtin && (
              <span className="text-muted-foreground border-input ml-2 border px-1 text-xs">
                {m.impurityTypes.builtin}
              </span>
            )}
          </>
        ),
      },
      {
        key: "note",
        header: m.impurityTypes.note,
        kind: "text",
        width: 380,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-xs",
        render: (r) => r.note ?? "",
      },
      {
        key: "substanceCount",
        header: m.impurityTypes.substanceCount,
        kind: "number",
        width: 88,
        sortable: false,
        filterable: false,
        className: "text-right font-mono tabular-nums text-xs",
        render: (r) => r.substanceCount.toLocaleString(locale),
      },
    ],
    [m, locale],
  );

  const { state, setState } = useTableState("chem.table.impurityTypes", columns, DEFAULT_STATE);

  const loadTypes = useCallback(async () => {
    const res = await fetch("/api/impurity-types").catch(() => null);
    if (!res?.ok) {
      if (res) redirectIfUnauthorized(res);
      return;
    }
    const body = (await res.json()) as ListResponse<ImpurityTypeDto>;
    setTypes(body.items);
    setSelectedId((cur) => cur ?? body.items.find((p) => p.id !== IMPURITY_NONE)?.id ?? null);
  }, []);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  // 法律と区分は件数が知れているので全部引く
  useEffect(() => {
    void (async () => {
      const [l, c] = await Promise.all([
        fetch("/api/laws?size=200").catch(() => null),
        fetch("/api/regulation-categories?size=500").catch(() => null),
      ]);
      if (l?.ok) setLaws(((await l.json()) as ListResponse<LawDto>).items);
      if (c?.ok) setCategories(((await c.json()) as ListResponse<RegulationCategoryDto>).items);
    })();
  }, []);

  const loadExemptions = useCallback(async (typeId: string) => {
    const res = await fetch(`/api/impurity-types/${typeId}/exemptions`).catch(() => null);
    if (!res?.ok) return;
    setExempt((await res.json()) as ImpurityExemptionsDto);
  }, []);

  useEffect(() => {
    if (!selectedId || selectedId === IMPURITY_NONE) {
      setExempt(null);
      return;
    }
    void loadExemptions(selectedId);
  }, [selectedId, loadExemptions]);

  const byLaw = useMemo(() => {
    const out = new Map<string, RegulationCategoryDto[]>();
    for (const c of categories) {
      const list = out.get(c.lawId);
      if (list) list.push(c);
      else out.set(c.lawId, [c]);
    }
    return out;
  }, [categories]);

  const excluded = useMemo(() => new Set(exempt?.categoryIds ?? []), [exempt]);
  /** 区分ごとの、法文物質名の上書きの数（「例外 N 件」に出す） */
  const overridesByCategory = useMemo(() => {
    const out = new Map<string, number>();
    for (const x of exempt?.substances ?? []) {
      out.set(x.categoryId, (out.get(x.categoryId) ?? 0) + 1);
    }
    return out;
  }, [exempt]);

  /** 区分の付け外し。1 回ごとに保存する */
  async function toggleCategories(categoryIds: string[], next: boolean) {
    if (!selectedId || categoryIds.length === 0) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/impurity-types/${selectedId}/exemptions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds, excluded: next }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      await loadExemptions(selectedId);
    } finally {
      setSaving(false);
    }
  }

  async function saveType() {
    setError(null);
    setSaving(true);
    try {
      const creating = form.id === "";
      const res = await fetch(creating ? "/api/impurity-types" : `/api/impurity-types/${form.id}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          nameJa: form.nameJa,
          nameEn: form.nameEn || null,
          note: form.note || null,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setAdding(false);
      setForm(EMPTY_FORM);
      await loadTypes();
    } finally {
      setSaving(false);
    }
  }

  /** まとめて削除。組み込み（0・1）はサーバーが断るので、そのまま知らせる */
  async function removeSelected(rows: ImpurityTypeDto[]) {
    setError(null);
    for (const p of rows) {
      const res = await fetch(`/api/impurity-types/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (selectedId === p.id) setSelectedId(null);
    }
    await loadTypes();
  }

  const lawName = (l: LawDto) => pickStatutoryName(locale, l.nameOriginal, l.nameJa, l.nameEn);
  const catName = (c: RegulationCategoryDto) =>
    pickStatutoryName(locale, c.nameOriginal, c.nameJa, c.nameEn);

  return (
    <div className="space-y-4 p-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>{m.impurityTypes.title}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">{m.impurityTypes.lead}</p>
          </div>
          {editable && !adding && (
            <Button
              size="sm"
              onClick={() => {
                setForm(EMPTY_FORM);
                setAdding(true);
              }}
            >
              {m.impurityTypes.add}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {editable && adding && (
            <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
              <div className="w-28 space-y-1">
                <Label htmlFor="ip-code">{m.impurityTypes.code}</Label>
                <Input
                  id="ip-code"
                  value={form.code}
                  maxLength={50}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="h-8"
                />
              </div>
              <div className="w-56 space-y-1">
                <Label htmlFor="ip-name">{m.impurityTypes.name}</Label>
                <Input
                  id="ip-name"
                  value={form.nameJa}
                  maxLength={200}
                  onChange={(e) => setForm({ ...form, nameJa: e.target.value })}
                  className="h-8"
                />
              </div>
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="ip-note">{m.impurityTypes.note}</Label>
                <Input
                  id="ip-note"
                  value={form.note}
                  maxLength={2000}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="h-8"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={saving || form.code.trim() === "" || form.nameJa.trim() === ""}
                  onClick={() => void saveType()}
                >
                  {saving ? m.common.saving : m.common.save}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAdding(false)}>
                  {m.common.cancel}
                </Button>
              </div>
            </div>
          )}

          <DataTable
            storageKey="chem.table.impurityTypes"
            columns={columns}
            rows={types}
            rowKey={(r) => r.id}
            total={types.length}
            state={state}
            defaultState={DEFAULT_STATE}
            onStateChange={setState}
            emptyMessage={m.impurityTypes.empty}
            showPager={false}
            showFilters={false}
            // 行を選ぶと、下の表がその種別の設定になる
            selectedKey={selectedId}
            onRowSelect={(r) => setSelectedId(r.id)}
            // 組み込み（0・1）は消せないので、選べるのはそれ以外だけ
            selectable={editable}
            onDeleteSelected={(rows) => void removeSelected(rows)}
            rowAction={
              editable
                ? {
                    onClick: (r) => {
                      setForm({
                        id: r.id,
                        code: r.code,
                        nameJa: r.nameJa,
                        nameEn: r.nameEn ?? "",
                        note: r.note ?? "",
                      });
                      setAdding(true);
                    },
                  }
                : undefined
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-5">
            {m.impurityTypes.exemptions}
            {selected && (
              <span className="bg-primary text-primary-foreground rounded px-2 py-0.5 font-mono text-sm">
                {selected.code}
              </span>
            )}
          </CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">{m.impurityTypes.exemptionsHint}</p>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="text-muted-foreground text-sm">{m.impurityTypes.empty}</p>
          ) : selected.isNone ? (
            <Alert>
              <AlertDescription>{m.impurityTypes.noneHasNoExemption}</AlertDescription>
            </Alert>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-primary text-primary-foreground">
                  <th className="w-10 px-2 py-1" />
                  <th className="px-2 py-1 text-left">{m.laws.title}</th>
                  <th className="w-32 px-2 py-1 text-center">{m.impurityTypes.exclude}</th>
                  <th className="w-28 px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {laws.map((law) => {
                  const cats = byLaw.get(law.id) ?? [];
                  const on = cats.filter((c) => excluded.has(c.id)).length;
                  const open = openLaws.has(law.id);
                  return (
                    <ImpurityLawRows
                      key={law.id}
                      law={law}
                      cats={cats}
                      open={open}
                      onToggleOpen={() =>
                        setOpenLaws((prev) => {
                          const next = new Set(prev);
                          if (next.has(law.id)) next.delete(law.id);
                          else next.add(law.id);
                          return next;
                        })
                      }
                      allOn={cats.length > 0 && on === cats.length}
                      someOn={on > 0 && on < cats.length}
                      excluded={excluded}
                      editable={editable}
                      saving={saving}
                      lawName={lawName(law)}
                      catName={catName}
                      overrides={overridesByCategory}
                      onToggleLaw={(next) =>
                        void toggleCategories(
                          cats.map((c) => c.id),
                          next,
                        )
                      }
                      onToggleCategory={(id, next) => void toggleCategories([id], next)}
                      onOpenExceptions={setExceptionsFor}
                      exceptionsLabel={m.impurityTypes.exceptions}
                    />
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {exceptionsFor && selected && (
        <ExceptionsDialog
          type={selected}
          category={exceptionsFor}
          onClose={() => {
            setExceptionsFor(null);
            void loadExemptions(selected.id);
          }}
          editable={editable}
        />
      )}
    </div>
  );
}

/** 法律 1 件と、その区分の行 */
function ImpurityLawRows({
  law,
  cats,
  open,
  onToggleOpen,
  allOn,
  someOn,
  excluded,
  editable,
  saving,
  lawName,
  catName,
  overrides,
  onToggleLaw,
  onToggleCategory,
  onOpenExceptions,
  exceptionsLabel,
}: {
  law: LawDto;
  cats: RegulationCategoryDto[];
  open: boolean;
  onToggleOpen: () => void;
  allOn: boolean;
  someOn: boolean;
  excluded: Set<string>;
  editable: boolean;
  saving: boolean;
  lawName: string;
  catName: (c: RegulationCategoryDto) => string;
  overrides: Map<string, number>;
  onToggleLaw: (next: boolean) => void;
  onToggleCategory: (id: string, next: boolean) => void;
  onOpenExceptions: (c: RegulationCategoryDto) => void;
  exceptionsLabel: (n: number) => string;
}) {
  return (
    <>
      <tr className="border-border border-b">
        <td className="px-2 py-1">
          <button type="button" onClick={onToggleOpen} aria-expanded={open}>
            <ChevronRight
              className={cn(
                "text-muted-foreground size-4 transition-transform",
                open && "rotate-90",
              )}
            />
          </button>
        </td>
        <td className="px-2 py-1 font-medium">
          <span className="text-muted-foreground mr-2 font-mono text-xs">{law.code}</span>
          {lawName}
        </td>
        <td className="px-2 py-1 text-center">
          <input
            type="checkbox"
            checked={allOn}
            ref={(el) => {
              if (el) el.indeterminate = someOn;
            }}
            disabled={!editable || saving || cats.length === 0}
            aria-label={lawName}
            onChange={() => onToggleLaw(!allOn)}
          />
        </td>
        <td />
      </tr>
      {open &&
        cats.map((c) => (
          <tr key={c.id} className="border-border border-b">
            <td />
            <td className="px-2 py-1 pl-6">
              <span className="text-muted-foreground mr-2 font-mono text-xs">{c.code}</span>
              {catName(c)}
            </td>
            <td className="px-2 py-1 text-center">
              <input
                type="checkbox"
                checked={excluded.has(c.id)}
                disabled={!editable || saving}
                aria-label={catName(c)}
                onChange={() => onToggleCategory(c.id, !excluded.has(c.id))}
              />
            </td>
            <td className="px-2 py-1 text-right">
              <Button size="sm" variant="ghost" onClick={() => onOpenExceptions(c)}>
                {exceptionsLabel(overrides.get(c.id) ?? 0)}
              </Button>
            </td>
          </tr>
        ))}
    </>
  );
}

/** 法文物質名ごとの上書き */
function ExceptionsDialog({
  type,
  category,
  onClose,
  editable,
}: {
  type: ImpurityTypeDto;
  category: RegulationCategoryDto;
  onClose: () => void;
  editable: boolean;
}) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<StatutorySubstanceDto[]>([]);
  /** 当たった全件。出しているのは先頭 200 件なので、多いときは絞ってもらう */
  const [total, setTotal] = useState(0);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [query, setQuery] = useState("");
  const [onlyExceptions, setOnlyExceptions] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ size: "200", "f.categoryId": `in:${category.id}` });
    if (query.trim() !== "") params.set("f.nameJa", `contains:${query.trim()}`);
    const [s, e] = await Promise.all([
      fetch(`/api/statutory-substances?${params.toString()}`).catch(() => null),
      fetch(`/api/impurity-types/${type.id}/exemptions`).catch(() => null),
    ]);
    if (s?.ok) {
      const body = (await s.json()) as ListResponse<StatutorySubstanceDto>;
      setItems(body.items);
      setTotal(body.total);
    }
    if (e?.ok) {
      const body = (await e.json()) as ImpurityExemptionsDto;
      setOverrides(new Map(body.substances.map((x) => [x.statutorySubstanceId, x.excluded])));
    }
  }, [category.id, type.id, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function set(statutorySubstanceId: string, excluded: boolean | null) {
    await fetch(`/api/impurity-types/${type.id}/exemptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statutorySubstanceId, excluded }),
    }).catch(() => null);
    await load();
  }

  const shown = onlyExceptions ? items.filter((s) => overrides.has(s.id)) : items;

  return (
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-6">
      <Card className="max-h-[80vh] w-[56rem] overflow-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{m.impurityTypes.exceptionsTitle}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">{m.impurityTypes.exceptionsHint}</p>
          </div>
          <Button size="sm" variant="outline" onClick={onClose}>
            {m.common.close}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              value={query}
              placeholder={m.statutorySubstances.nameJa}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 w-64"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyExceptions}
                onChange={() => setOnlyExceptions(!onlyExceptions)}
              />
              {m.impurityTypes.onlyExceptions}
            </label>
            {/* **出している数と全体の数を必ず出す。**黙って切ると、続きがあることに気づけない */}
            <span className="text-muted-foreground text-xs">
              {m.table.showingOf(shown.length, total)}
            </span>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-primary text-primary-foreground">
                <th className="px-2 py-1 text-left">{m.statutorySubstances.title}</th>
                <th className="w-64 px-2 py-1 text-left">{m.impurityTypes.exclude}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const cur = overrides.get(s.id);
                const value = cur === undefined ? "" : cur ? "yes" : "no";
                return (
                  <tr key={s.id} className="border-border border-b">
                    <td className="px-2 py-1">
                      {pickStatutoryName(locale, s.nameOriginal, s.nameJa, s.nameEn)}
                    </td>
                    <td className="px-2 py-1">
                      <select
                        className="border-input bg-background h-8 w-full rounded-none border px-2 text-sm"
                        value={value}
                        disabled={!editable}
                        aria-label={m.impurityTypes.exclude}
                        onChange={(e) =>
                          void set(s.id, e.target.value === "" ? null : e.target.value === "yes")
                        }
                      >
                        <option value="">{m.impurityTypes.followCategory}</option>
                        <option value="yes">{m.impurityTypes.excludeHere}</option>
                        <option value="no">{m.impurityTypes.dontExcludeHere}</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
