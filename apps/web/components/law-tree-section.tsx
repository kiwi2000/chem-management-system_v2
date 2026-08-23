"use client";

import {
  emptyTableState,
  formatThreshold,
  pickName,
  pickStatutoryName,
  serializeTableState,
  type TableState,
} from "@chem/shared";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { LawForm } from "@/components/law-form";
import { RegulationCategoryForm } from "@/components/regulation-category-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  CountryDto,
  LanguageDto,
  LawDto,
  ListResponse,
  RegulationCategoryDto,
} from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";
import { cn } from "@/lib/utils";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "displayOrder", direction: "asc" }]);

/**
 * 法令と、その配下の区分を1つの表にまとめたもの。
 *
 * 表を2つ並べると場所を食ううえ、どちらが親か目で追いにくい。
 * 法令の行を開くと、その下に区分が字下げして並ぶ形にしてある。
 * 区分は開いた法令のぶんだけ取りに行く（全部まとめて引かない）。
 */

/** 表に流す行。法令と区分が混ざるので、種別を持たせて描き分ける */
type Row =
  | { kind: "law"; key: string; law: LawDto }
  | { kind: "category"; key: string; law: LawDto; category: RegulationCategoryDto };

/**
 * 選んだ区分と、その周辺。
 * 見出しに法令名を出し、［‹ ›］で前後の区分へ移るので、法令と兄弟も一緒に渡す。
 */
export interface CategorySelection {
  law: LawDto;
  category: RegulationCategoryDto;
  /** 同じ法令の区分（表示順）。前後移動はこの中だけで、法令はまたがない */
  siblings: RegulationCategoryDto[];
}

export function LawTreeSection({
  languages,
  selected,
  onSelect,
}: {
  languages: LanguageDto[];
  /** 選んでいる区分。閾値のひな型を下の表へ渡すので、idではなく行そのものを扱う */
  selected: RegulationCategoryDto | null;
  onSelect: (selection: CategorySelection | null) => void;
}) {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [countries, setCountries] = useState<CountryDto[]>([]);
  const [data, setData] = useState<ListResponse<LawDto> | null>(null);
  /** 開いている法令。値はその法令の区分（取りに行くまでは undefined） */
  const [open, setOpen] = useState<Map<string, RegulationCategoryDto[] | undefined>>(new Map());
  /** いま選んでいる法令。区分の追加先になる */
  const [lawId, setLawId] = useState<string | null>(null);

  const [editing, setEditing] = useState<
    | { kind: "law"; initial: LawDto | null }
    | { kind: "category"; lawId: string; initial: RegulationCategoryDto | null }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  // 列のキーの並びだけを useTableState が見るので、中身は毎回作ってよい
  const columns = useMemo<TableColumn<Row>[]>(
    () => [
      {
        key: "code",
        header: m.laws.code,
        kind: "text",
        width: 120,
        className: "font-mono",
        render: (r) =>
          r.kind === "law" ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void toggle(r.law.id);
              }}
              aria-expanded={open.has(r.law.id)}
              aria-label={open.has(r.law.id) ? m.common.close : m.common.open}
              className="hover:text-foreground -ml-1 inline-flex items-center gap-1 text-left"
            >
              <ChevronRight
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-transform",
                  open.has(r.law.id) && "rotate-90",
                )}
              />
              {r.law.code}
            </button>
          ) : (
            <span className="pl-5">{r.category.code}</span>
          ),
      },
      {
        key: "nameJa",
        header: m.laws.title,
        kind: "text",
        width: 240,
        render: (r) =>
          r.kind === "law"
            ? pickStatutoryName(locale, r.law.nameOriginal, r.law.nameJa, r.law.nameEn)
            : pickStatutoryName(
                locale,
                r.category.nameOriginal,
                r.category.nameJa,
                r.category.nameEn,
              ),
      },
      {
        key: "countryId",
        header: m.laws.country,
        kind: "enum",
        width: 110,
        options: countries.map((c) => ({
          value: c.id,
          label: pickName(locale, c.nameJa, c.nameEn),
        })),
        render: (r) =>
          r.kind === "law" ? pickName(locale, r.law.countryNameJa, r.law.countryNameEn) : "",
      },
      {
        key: "threshold",
        header: m.regulationCategories.threshold,
        kind: "text",
        width: 130,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground font-mono text-xs",
        render: (r) =>
          r.kind === "category"
            ? formatThreshold(
                r.category.thresholdLower,
                r.category.lowerBound,
                r.category.thresholdUpper,
                r.category.upperBound,
              )
            : "",
      },
      {
        key: "count",
        header: m.regulationCategories.title,
        kind: "number",
        width: 64,
        sortable: false,
        filterable: false,
        className: "text-muted-foreground text-right text-xs",
        render: (r) => (r.kind === "law" ? r.law.categoryCount : r.category.substanceCount),
      },
    ],
    // toggle は毎回作られるが、列のキーは変わらないので描き直しだけで足りる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [m, locale, countries, open],
  );

  const {
    state: tableState,
    setState,
    reset,
    ready,
  } = useTableState("chem.table.lawTree", columns, DEFAULT_STATE);

  const listQuery = useMemo(
    () => serializeTableState(tableState, DEFAULT_STATE).toString(),
    [tableState],
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/laws?${listQuery}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return null;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return null;
    }
    const body = (await res.json()) as ListResponse<LawDto>;
    setData(body);
    return body;
  }, [listQuery, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/countries?size=200").catch(() => null);
      if (!res || !res.ok || !alive) return;
      const body = (await res.json()) as ListResponse<CountryDto>;
      if (alive) setCountries(body.items);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** その法令の区分を取りに行く。開いている法令ぶんだけ引く */
  const loadCategories = useCallback(async (id: string) => {
    const res = await fetch(
      `/api/regulation-categories?size=200&f.lawId=in:${id}&sort=displayOrder`,
    ).catch(() => null);
    if (!res || !res.ok) return null;
    const body = (await res.json()) as ListResponse<RegulationCategoryDto>;
    setOpen((prev) => new Map(prev).set(id, body.items));
    return body.items;
  }, []);

  async function toggle(id: string) {
    if (open.has(id)) {
      setOpen((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      return;
    }
    setOpen((prev) => new Map(prev).set(id, undefined));
    await loadCategories(id);
  }

  /**
   * 保存や削除のあと、見えている範囲を取り直す。
   * 見出しは選んだ区分の中身をそのまま映すので、選択中のものは取り直したもので差し替える。
   */
  async function refresh() {
    const laws = await load();
    const lists = await Promise.all(
      [...open.keys()].map(async (id) => [id, await loadCategories(id)] as const),
    );
    if (!selected) return;
    for (const [id, items] of lists) {
      const fresh = items?.find((c) => c.id === selected.id);
      if (!fresh || !items) continue;
      const law = laws?.items.find((l) => l.id === id);
      if (law) onSelect({ law, category: fresh, siblings: items });
      return;
    }
    // 選んでいた区分が消えた（削除された・法令を閉じた）
    onSelect(null);
  }

  async function onDeleteSelected(targets: Row[]) {
    setError(null);
    for (const r of targets) {
      const url =
        r.kind === "law" ? `/api/laws/${r.law.id}` : `/api/regulation-categories/${r.category.id}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (r.kind === "category" && selected?.id === r.category.id) onSelect(null);
      if (r.kind === "law" && lawId === r.law.id) setLawId(null);
    }
    void refresh();
  }

  // 法令の行と、開いている法令の区分の行を、順に並べる
  const rows: Row[] | null =
    data === null
      ? null
      : data.items.flatMap((law) => {
          const head: Row = { kind: "law", key: `law:${law.id}`, law };
          const kids = open.get(law.id) ?? [];
          return [
            head,
            ...kids.map((category): Row => ({
              kind: "category",
              key: `cat:${category.id}`,
              law,
              category,
            })),
          ];
        });

  const selectedKey = selected ? `cat:${selected.id}` : lawId ? `law:${lawId}` : null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{m.laws.title}</h2>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {editable && editing?.kind === "law" && (
        <LawForm
          languages={languages}
          countries={countries}
          initial={editing.initial}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {editable && editing?.kind === "category" && (
        <RegulationCategoryForm
          languages={languages}
          lawId={editing.lawId}
          initial={editing.initial}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      <DataTable
        storageKey="chem.table.lawTree"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        total={data?.total ?? 0}
        state={tableState}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={countries.length === 0 ? m.laws.noCountry : m.laws.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        showFilters={false}
        showOpenHint={false}
        busyOnActivate={false}
        pageSizeOptions={[10, 25, 50, 100]}
        selectedKey={selectedKey}
        onRowSelect={(r) => {
          if (r.kind === "law") {
            setLawId(r.law.id);
            onSelect(null);
          } else {
            setLawId(r.law.id);
            onSelect({
              law: r.law,
              category: r.category,
              siblings: open.get(r.law.id) ?? [r.category],
            });
          }
        }}
        onRowActivate={
          editable
            ? (r) =>
                setEditing(
                  r.kind === "law"
                    ? { kind: "law", initial: r.law }
                    : { kind: "category", lawId: r.law.id, initial: r.category },
                )
            : undefined
        }
        headerActions={
          editable && !editing ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={countries.length === 0}
                onClick={() => setEditing({ kind: "law", initial: null })}
              >
                {m.laws.add}
              </Button>
              <Button
                size="sm"
                disabled={!lawId}
                onClick={() => {
                  if (!lawId) return;
                  // 追加したものがすぐ見えるよう、その法令を開いておく
                  if (!open.has(lawId)) void toggle(lawId);
                  setEditing({ kind: "category", lawId, initial: null });
                }}
              >
                {m.regulationCategories.add}
              </Button>
            </div>
          ) : undefined
        }
      />
    </section>
  );
}
