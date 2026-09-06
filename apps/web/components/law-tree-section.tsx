"use client";

import {
  emptyTableState,
  formatThreshold,
  pickName,
  pickStatutoryName,
  serializeTableState,
  type ScoreRange,
  type TableState,
} from "@chem/shared";
import { ChevronRight, FoldVertical, UnfoldVertical } from "lucide-react";
import Link from "next/link";
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
 * 法律と、その配下の区分を1つの表にまとめたもの。
 *
 * 表を2つ並べると場所を食ううえ、どちらが親か目で追いにくい。
 * 法律の行を開くと、その下に区分が字下げして並ぶ形にしてある。
 * 区分は開いた法律のぶんだけ取りに行く（全部まとめて引かない）。
 */

/** 表に流す行。法律と区分が混ざるので、種別を持たせて描き分ける */
type Row =
  | { kind: "law"; key: string; law: LawDto }
  | { kind: "category"; key: string; law: LawDto; category: RegulationCategoryDto };

/**
 * 選んだ区分と、その周辺。
 * 見出しに法律名を出し、［‹ ›］で前後の区分へ移るので、法律と兄弟も一緒に渡す。
 */
export interface CategorySelection {
  law: LawDto;
  category: RegulationCategoryDto;
  /** 同じ法律の区分（表示順）。前後移動はこの中だけで、法律はまたがない */
  siblings: RegulationCategoryDto[];
}

export function LawTreeSection({
  languages,
  scoreRange,
  selected,
  onSelect,
}: {
  languages: LanguageDto[];
  /** 区分に入れられるスコアの範囲。システム設定の値をページから渡す */
  scoreRange: ScoreRange;
  /** 選んでいる区分。閾値のひな型を下の表へ渡すので、idではなく行そのものを扱う */
  selected: RegulationCategoryDto | null;
  onSelect: (selection: CategorySelection | null) => void;
}) {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  const [countries, setCountries] = useState<CountryDto[]>([]);
  const [data, setData] = useState<ListResponse<LawDto> | null>(null);
  /** 開いている法律。値はその法律の区分（取りに行くまでは undefined） */
  const [open, setOpen] = useState<Map<string, RegulationCategoryDto[] | undefined>>(new Map());
  /** いま選んでいる法律。区分の追加先になる */
  const [lawId, setLawId] = useState<string | null>(null);

  const [editing, setEditing] = useState<
    | { kind: "law"; initial: LawDto | null }
    | { kind: "category"; lawId: string; initial: RegulationCategoryDto | null }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  /** まとめて開いている最中。件数が多いと少し待つ */
  const [expanding, setExpanding] = useState(false);

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
            // 法律にぶら下がっていることを縦線で示す。区分が続いても親を見失わない
            <span className="border-border ml-2 border-l pl-3 text-xs">
              {/* 押すと法文物質名の一覧へ移る。インベントリのコードと同じ形 */}
              <Link
                href={`/categories/${r.category.id}`}
                onClick={(e) => e.stopPropagation()}
                className="underline underline-offset-2"
              >
                {r.category.code}
              </Link>
            </span>
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
        // 国の1つ上。大きい単位から並べると、どのあたりの法律かを追いやすい
        key: "regionId",
        header: m.laws.region,
        kind: "enum",
        width: 100,
        // 地域は国の表から拾う（法律の一覧に地域そのものは持っていない）
        options: [...new Map(countries.map((c) => [c.regionId, c])).values()].map((c) => ({
          value: c.regionId,
          label: pickName(locale, c.regionNameJa, c.regionNameEn),
        })),
        render: (r) =>
          r.kind === "law" ? pickName(locale, r.law.regionNameJa, r.law.regionNameEn) : "",
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
        /*
          判定に使わない区分の印。**閾値の隣に置く。**
          閾値だけを見て「この濃度で該当する」と読まれると取り違える
        */
        key: "judged",
        header: m.regulationCategories.judged,
        kind: "text",
        width: 104,
        sortable: false,
        filterable: false,
        className: "text-xs",
        render: (r) =>
          r.kind === "category" && !r.category.judged ? (
            <span className="text-muted-foreground border-input border px-1.5 py-0.5">
              {m.regulationCategories.judgedOff}
            </span>
          ) : (
            ""
          ),
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
        /* 区分に付けた点数。**閾値の隣に置く。**どちらも判定に効く数字なので並べて読める */
        key: "score",
        header: m.score.categoryScore,
        kind: "number",
        width: 72,
        sortable: false,
        filterable: false,
        className: "text-right font-mono text-xs",
        render: (r) => (r.kind === "category" ? r.category.score : ""),
      },
      {
        // 表には出さない、絞り込みだけの列。区分の側を探して法律を絞る
        key: "categoryCode",
        header: m.regulationCategories.code,
        kind: "text",
        filterOnly: true,
        width: 0,
      },
      {
        key: "categoryName",
        header: m.regulationCategories.title,
        kind: "text",
        filterOnly: true,
        width: 0,
      },
      {
        /*
          スコアでの絞り込み。区分の側を探して、当たった区分を持つ法律だけを残す。
          数の列なので「30以上」「70未満」のような指定ができる
        */
        key: "categoryScore",
        header: m.score.categoryScore,
        kind: "number",
        filterOnly: true,
        width: 0,
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
    ready,
  } = useTableState("chem.table.lawTree", columns, DEFAULT_STATE);

  /*
    区分での絞り込み。
    区分は法律にぶら下がって出てくるので、法律の一覧を引くだけでは絞れない。
    先に区分の側を探し、当たった区分を持つ法律だけを残して、その法律を開いておく。
  */
  const categoryQueries = useMemo(() => {
    const byCode = tableState.filters.categoryCode;
    const byName = tableState.filters.categoryName;
    const byScore = tableState.filters.categoryScore;
    if (!byCode && !byName && !byScore) return null;
    const build = (filters: TableState["filters"]) =>
      serializeTableState(
        { sort: [{ column: "displayOrder", direction: "asc" }], filters, page: 1, pageSize: 200 },
        emptyTableState(),
      ).toString();
    return {
      code: byCode ? build({ code: byCode }) : null,
      score: byScore ? build({ score: byScore }) : null,
      // 名称は原文・日本語・英語のどれに入っているか決まっていないので、3つとも探して合わせる
      names: byName
        ? [build({ nameOriginal: byName }), build({ nameJa: byName }), build({ nameEn: byName })]
        : null,
    };
  }, [tableState.filters]);

  /** 絞り込みに当たった区分。条件が無いときは null（＝絞らない） */
  const [hits, setHits] = useState<RegulationCategoryDto[] | null>(null);
  /** 当たった区分を持つ法律。条件が無いときは null（＝絞らない） */
  const hitLawIds = hits ? new Set(hits.map((c) => c.lawId)) : null;
  /** 絞り込む法律の id。並びを毎回同じにして、引き直しを増やさない */
  const hitLawKey = hitLawIds ? [...hitLawIds].sort().join("|") : null;

  const listQuery = useMemo(
    () => serializeTableState(tableState, DEFAULT_STATE).toString(),
    [tableState],
  );

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams(listQuery);
    /*
      区分で絞っているときは、**当たった法律だけをサーバーに出させる**。
      画面の側で切ると、いま出ているページに無い法律が落ちてしまい、
      「1件も無い」と見えてしまう（実際にそうなっていた）
    */
    if (hitLawKey !== null) {
      if (hitLawKey === "") {
        setData({ items: [], total: 0, page: 1, pageSize: tableState.pageSize });
        return null;
      }
      params.set("f.id", `any:${hitLawKey}`);
    }
    const res = await fetch(`/api/laws?${params.toString()}`);
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
    // tableState.pageSize は空の結果を作るときだけ使う（引き直しの合図にはしない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery, hitLawKey, m]);

  useEffect(() => {
    // 区分で絞っているあいだは、当たった区分が分かるまで引かない
    if (ready && !(categoryQueries !== null && hits === null)) void load();
  }, [ready, load, categoryQueries, hits]);

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

  useEffect(() => {
    if (!categoryQueries) {
      setHits(null);
      return;
    }
    let alive = true;
    const fetchOne = async (query: string) => {
      const res = await fetch(`/api/regulation-categories?${query}`).catch(() => null);
      if (!res || !res.ok) return [];
      return ((await res.json()) as ListResponse<RegulationCategoryDto>).items;
    };
    void (async () => {
      const { code, names, score } = categoryQueries;
      let items: RegulationCategoryDto[] = [];
      if (names) {
        const lists = await Promise.all(names.map(fetchOne));
        // 同じ区分が複数の欄で当たることがあるので、idでまとめる
        const byId = new Map(lists.flat().map((c) => [c.id, c]));
        items = [...byId.values()];
      }
      if (score) {
        const byScore = await fetchOne(score);
        // ほかの条件も指定されていれば、どちらにも当たったものだけ
        const ids = new Set(byScore.map((c) => c.id));
        items = names ? items.filter((c) => ids.has(c.id)) : byScore;
      }
      if (code) {
        const byCode = await fetchOne(code);
        // 両方指定されていれば、どちらにも当たったものだけ
        items = names ? items.filter((c) => byCode.some((x) => x.id === c.id)) : byCode;
      }
      if (alive) setHits(items);
    })();
    return () => {
      alive = false;
    };
  }, [categoryQueries]);

  /** その法律の区分を引くだけ。開いた状態にはしない */
  const fetchCategories = useCallback(async (id: string) => {
    const res = await fetch(
      `/api/regulation-categories?size=200&f.lawId=in:${id}&sort=displayOrder`,
    ).catch(() => null);
    if (!res || !res.ok) return null;
    return ((await res.json()) as ListResponse<RegulationCategoryDto>).items;
  }, []);

  /** その法律の区分を取りに行って、開いた状態にする */
  const loadCategories = useCallback(
    async (id: string) => {
      const items = await fetchCategories(id);
      if (items) setOpen((prev) => new Map(prev).set(id, items));
      return items;
    },
    [fetchCategories],
  );

  /** 全部の法律をまとめて開く。区分はまとめて引く */
  async function expandAll() {
    const laws = data?.items ?? [];
    if (laws.length === 0) return;
    setExpanding(true);
    try {
      const lists = await Promise.all(
        laws.map(async (l) => [l.id, await fetchCategories(l.id)] as const),
      );
      setOpen(new Map(lists.map(([id, items]) => [id, items ?? undefined])));
    } finally {
      setExpanding(false);
    }
  }

  /*
    区分が当たった法律は開いた状態にする。
    出すのは当たった区分だけ。当たらなかったものを混ぜると、どれが当たりか分からなくなる。
  */
  useEffect(() => {
    if (hits === null) {
      // 条件を外したら、絞り込んだときの中途半端な中身を残さない
      setOpen(new Map());
      return;
    }
    const byLaw = new Map<string, RegulationCategoryDto[]>();
    for (const c of hits) {
      const list = byLaw.get(c.lawId);
      if (list) list.push(c);
      else byLaw.set(c.lawId, [c]);
    }
    setOpen(byLaw);
  }, [hits]);

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
    // 選んでいた区分が消えた（削除された・法律を閉じた）
    onSelect(null);
  }

  /**
   * 行を引いて並べ替える。**表示順の数字は打たない。**
   * 1件ずつ数字を書き換えるのは手間がかかるうえ、
   * 途中に割り込ませるたびに前後の番号を数え直すことになる。
   *
   * 落とせるのは**同じ種類・同じ親の行だけ**。
   * 法律は同じ国の中、区分は同じ法律の中。並びは 地域 → 国 → 法律 → 区分 で
   * 決まっているので、それをまたぐ位置へは出られない。
   */
  async function onReorder(fromKey: string, toKey: string) {
    const from = (rows ?? []).find((r) => r.key === fromKey);
    const to = (rows ?? []).find((r) => r.key === toKey);
    if (!from || !to || from.key === to.key) return;
    setError(null);

    if (from.kind === "law" && to.kind === "law") {
      if (from.law.countryId !== to.law.countryId) {
        setError(m.laws.sameCountryOnly);
        return;
      }
      await move(`/api/laws/${from.law.id}/move`, to.law.id);
      return;
    }
    if (from.kind === "category" && to.kind === "category") {
      if (from.law.id !== to.law.id) {
        setError(m.laws.sameLawOnly);
        return;
      }
      await move(`/api/regulation-categories/${from.category.id}/move`, to.category.id);
      return;
    }
    // 法律の行と区分の行は入れ替えられない（親子なので位置に意味が無い）
    setError(from.kind === "law" ? m.laws.sameCountryOnly : m.laws.sameLawOnly);
  }

  async function move(url: string, targetId: string) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    void refresh();
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

  // 法律の行と、開いている法律の区分の行を、順に並べる
  const rows: Row[] | null =
    data === null || (categoryQueries !== null && hits === null)
      ? null
      : data.items
          .filter((law) => hitLawIds === null || hitLawIds.has(law.id))
          .flatMap((law) => {
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
          scoreRange={scoreRange}
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
        title={m.laws.title}
        storageKey="chem.table.lawTree"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        total={hitLawIds ? (rows?.filter((r) => r.kind === "law").length ?? 0) : (data?.total ?? 0)}
        state={tableState}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={countries.length === 0 ? m.laws.noCountry : m.laws.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        // 直せる人にだけ、つまみを出す
        onReorder={editable ? onReorder : undefined}
        pageSizeOptions={[15, 25, 50, 100]}
        // 左から詰めて並べる。指定しないと画面幅いっぱいに散らばってしまう
        filterLayout={[
          ["code", "nameJa", "countryId"],
          ["categoryCode", "categoryName", "categoryScore"],
        ]}
        // 法律は見出しの行。区分がいくつ続いても、どこまでが1つの法律か分かるようにする
        rowClassName={(r) => (r.kind === "law" ? "bg-muted/60 font-semibold" : undefined)}
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
        // 編集は行の右端の鉛筆から
        rowAction={
          editable
            ? {
                onClick: (r) =>
                  setEditing(
                    r.kind === "law"
                      ? { kind: "law", initial: r.law }
                      : { kind: "category", lawId: r.law.id, initial: r.category },
                  ),
              }
            : undefined
        }
        // つまみを出しているときだけ、引けることも添える
        hintText={editable ? `${m.laws.rowHint}／${m.laws.reorderHint}` : m.laws.rowHint}
        headerActions={
          <div className="flex gap-2">
            {/* 法律の数だけ開け閉めするのは手間なので、まとめて開く・閉じるを置く */}
            <Button
              size="sm"
              variant="outline"
              disabled={expanding || (data?.items.length ?? 0) === 0}
              onClick={() => void expandAll()}
            >
              <UnfoldVertical className="mr-1 size-3.5" />
              {m.composition.expandAll}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={open.size === 0}
              onClick={() => setOpen(new Map())}
            >
              <FoldVertical className="mr-1 size-3.5" />
              {m.composition.collapseAll}
            </Button>
            {editable && !editing && (
              <>
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
                  variant="outline"
                  disabled={!lawId}
                  onClick={() => {
                    if (!lawId) return;
                    // 追加したものがすぐ見えるよう、その法律を開いておく
                    if (!open.has(lawId)) void toggle(lawId);
                    setEditing({ kind: "category", lawId, initial: null });
                  }}
                >
                  {m.regulationCategories.add}
                </Button>
              </>
            )}
          </div>
        }
      />
    </section>
  );
}
