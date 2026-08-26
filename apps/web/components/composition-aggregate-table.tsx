"use client";

import { pickName, pickStatutoryName } from "@chem/shared";
import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useResizableColumns } from "@/components/data-table/resizable-columns";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, CompositionAggregateDto, RowRegulationDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * CASでまとめた組成。
 *
 * 原材料は末端の物質まで下ろされ、同じCAS番号のものは1行にまとまっている。
 * 法規制の判定に使うのはこの値なので、計算はサーバー側で行い、ここは出すだけにする
 * （画面で組み立てると、判定と表示で別々の計算になってしまう）。
 *
 * 寄与元が複数ある行だけ押して開ける。名称は、そのCASの代表物質から取っている。
 */

const CELL = "border-r px-2 py-1 last:border-r-0";

/** 行を指す鍵。CASを持たない物質は自分のコードで区別する */
const keyOf = (row: { casNumber: string | null; code: string }) => row.casNumber ?? row.code;

interface Props {
  productId: string;
  /** 開いている行。見出しの「展開」「閉じる」から操るので、状態は親が持つ */
  open: Set<string>;
  onOpenChange: (next: Set<string>) => void;
  /** 開ける行の鍵。親がボタンを出すかどうかの判断に使う */
  onExpandableChange: (keys: string[]) => void;
}

/**
 * 列の並びと既定の幅。
 *
 * 「かかる法規制」は**目印**なので、物質名より狭くてよい。
 * 規制の中身は下の判定表が受け持つ。
 */
const HEADS: {
  key: string;
  width: number;
  label: (m: ReturnType<typeof useI18n>["m"]) => string;
  className?: string;
}[] = [
  { key: "casNumber", width: 96, label: (m) => m.composition.casNumber },
  { key: "substanceId", width: 88, label: (m) => m.composition.aggregateSubstanceId },
  { key: "name", width: 256, label: (m) => m.composition.aggregateName },
  {
    key: "contentPct",
    width: 72,
    label: (m) => m.composition.contentPct,
    className: "text-right whitespace-nowrap",
  },
];

/**
 * 該当法規制の列。**地域でまとめておき、押すと規制区分ごとに分かれる。**
 *
 * この製品で該当している区分だけを列にする。全区分を並べると、
 * ほとんど空の列が延々と続いて、どこに印が付いているのか読めなくなる。
 *
 * 押していないあいだは地域が1列（国内・国際）。
 * 押すと、その地域の該当区分の数だけ列に分かれ、地域名のあった場所が区分名になる。
 */
interface LeafColumn {
  /** 列の鍵。幅を覚える単位になるので、地域・区分の id をそのまま使う */
  key: string;
  regionId: string;
  /** 区分の列なら、その区分の id。地域のままなら null */
  categoryId: string | null;
  label: string;
  /** その列が受け持つ規制区分の id */
  categoryIds: Set<string>;
  width: number;
}

/** 地域のまとまり。見出しで地域名のセルを横に伸ばすのに要る */
interface RegionGroup {
  regionId: string;
  label: string;
  expanded: boolean;
  /** この地域が占める列の数 */
  span: number;
}

/** 出ている行から、法規の列を組み立てる */
function leafColumns(
  rows: { regulations: RowRegulationDto[] }[],
  openRegions: Set<string>,
  locale: ReturnType<typeof useI18n>["locale"],
): { leaves: LeafColumn[]; groups: RegionGroup[] } {
  /** 地域 → その地域で該当している区分（並び順つき） */
  const regions = new Map<
    string,
    { order: number; label: string; categories: Map<string, { order: number; label: string }> }
  >();
  for (const row of rows) {
    for (const r of row.regulations) {
      const region = regions.get(r.regionId) ?? {
        order: r.regionOrder,
        label: pickName(locale, r.regionNameJa, r.regionNameEn),
        categories: new Map(),
      };
      region.categories.set(r.categoryId, {
        order: r.categoryOrder,
        // 区分名だけでは法令が分からないので、法令名を前に付ける
        label: `${pickStatutoryName(locale, r.lawNameOriginal, r.lawNameJa, r.lawNameEn)} ${pickStatutoryName(locale, r.categoryNameOriginal, r.categoryNameJa, r.categoryNameEn)}`,
      });
      regions.set(r.regionId, region);
    }
  }

  const leaves: LeafColumn[] = [];
  const groups: RegionGroup[] = [];
  for (const [regionId, region] of [...regions.entries()].sort((a, b) => a[1].order - b[1].order)) {
    if (!openRegions.has(regionId)) {
      leaves.push({
        key: `region:${regionId}`,
        regionId,
        categoryId: null,
        label: region.label,
        categoryIds: new Set(region.categories.keys()),
        width: 96,
      });
      groups.push({ regionId, label: region.label, expanded: false, span: 1 });
      continue;
    }
    const categories = [...region.categories.entries()].sort((a, b) => a[1].order - b[1].order);
    for (const [categoryId, c] of categories) {
      leaves.push({
        key: `category:${categoryId}`,
        regionId,
        categoryId,
        label: c.label,
        categoryIds: new Set([categoryId]),
        width: 128,
      });
    }
    groups.push({ regionId, label: region.label, expanded: true, span: categories.length });
  }
  return { leaves, groups };
}

export function CompositionAggregateTable({
  productId,
  open,
  onOpenChange,
  onExpandableChange,
}: Props) {
  const { m, locale } = useI18n();
  const [data, setData] = useState<CompositionAggregateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 区分まで分けて見ている地域。地域名を押すたびに出し入れする */
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set());
  /**
   * その区分に該当する行だけを見ている、という状態。
   * **区分名を押すと絞る。**押して閉じるのではない（閉じるのは地域名の役目）。
   */
  const [focus, setFocus] = useState<{ categoryId: string; label: string } | null>(null);

  const { leaves, groups } = leafColumns(data?.rows ?? [], openRegions, locale);
  // 列幅は一覧と同じ規則。法規の列は中身で増減するが、鍵が id なので幅は覚えたまま
  const cols = useResizableColumns(
    "chem.table.compositionAggregate",
    [...HEADS, ...leaves],
    // 規制区分に分けると列が増える。詰めずに、はみ出したぶんは横に送る
    { shrinkToFit: false },
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/products/${productId}/composition/aggregate`).catch(() => null);
      if (!res || !alive) return;
      if (redirectIfUnauthorized(res)) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        if (alive) setError(body?.error.message ?? m.errors.loadFailed(res.status));
        return;
      }
      const body = (await res.json()) as CompositionAggregateDto;
      if (alive) setData(body);
    })();
    return () => {
      alive = false;
    };
  }, [productId, m]);

  // 取れたら、開ける行の鍵を親に渡す（見出しのボタンを出すかどうかの判断に使う）
  useEffect(() => {
    onExpandableChange(
      (data?.rows ?? []).filter((r) => r.contributions.length > 1).map((r) => keyOf(r)),
    );
  }, [data, onExpandableChange]);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return <p className="text-muted-foreground text-sm">{m.common.loading}</p>;

  /**
   * 地域を、規制区分に分けて見るか、まとめて見るか。
   * 格納するときは、その地域の区分での絞り込みも解く（見えない列で絞られたままになるため）。
   */
  const toggleRegion = (regionId: string) => {
    const next = new Set(openRegions);
    if (next.has(regionId)) {
      next.delete(regionId);
      if (focus && leaves.some((c) => c.categoryId === focus.categoryId && c.regionId === regionId))
        setFocus(null);
    } else {
      next.add(regionId);
    }
    setOpenRegions(next);
  };

  /**
   * 表に出す行。区分で絞っているときは、その区分に該当するものだけ。
   * **合計は出さない。**絞った行だけを足した数字を「合計」と書くと、
   * 製品全体の合計と取り違える。
   */
  const visible = focus
    ? data.rows.filter((r) => r.regulations.some((x) => x.categoryId === focus.categoryId))
    : data.rows;

  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onOpenChange(next);
  };

  return (
    <div className="space-y-3">
      {/*
       * 開けなかった枝があると、この表は不完全になる。
       * 数字は完成して見えてしまうので、表より先に、目立つ形で伝える。
       */}
      {data.blocked.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{m.composition.aggregateIncomplete(data.blocked.length)}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {data.blocked.map((b, i) => (
                <li key={`${b.code}-${i}`}>
                  <span className="font-mono text-xs">{b.code}</span>{" "}
                  {pickName(locale, b.nameJa, b.nameEn)}（{b.pct}%）—{" "}
                  {b.reason === "empty" ? m.composition.expandEmpty : m.composition.expandNotFound}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {data.truncated > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{m.composition.expandTooDeep}</AlertDescription>
        </Alert>
      )}

      {/* 区分で絞っているあいだは、そのことと解きかたを必ず出す */}
      {focus && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {m.composition.aggregateFocused(focus.label, visible.length)}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setFocus(null)}>
            {m.composition.aggregateShowAllRows}
          </Button>
        </div>
      )}

      {data.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{m.composition.empty}</p>
      ) : (
        <div ref={cols.scrollerRef} className="overflow-x-auto">
          <table
            className="w-full table-fixed border-collapse text-sm"
            style={{ minWidth: cols.minTableWidth }}
          >
            <colgroup>{cols.cols()}</colgroup>
            {/*
              見出しは2段。上の段は「該当法規制」の見出しだけで、
              下の段が地域（押すと規制区分に分かれる）。
              組成そのものの列は2段ぶんの高さを取る。
            */}
            {/*
              見出しは3段。
                1段目 … 「該当法規制」の見出し
                2段目 … 地域。**分けても地域名のセルは残す**（横に伸びて、どこまでが
                        その地域かが分かる）。押すと分ける／格納する
                3段目 … 規制区分。押すと**その区分に該当する行だけ**になる（格納ではない）
              組成そのものの列は3段ぶんの高さを取る。
            */}
            <thead>
              <tr className="bg-muted/50 border-t text-left">
                {HEADS.map(({ key, label, className }) => (
                  <th
                    key={key}
                    rowSpan={3}
                    className={cn(CELL, "relative align-bottom font-medium", className)}
                  >
                    {label(m)}
                    {cols.handle(key, `${label(m)} ${m.table.resize}`)}
                  </th>
                ))}
                {leaves.length > 0 && (
                  <th colSpan={leaves.length} className={cn(CELL, "text-center font-medium")}>
                    {m.composition.aggregateRegulations}
                  </th>
                )}
              </tr>

              <tr className="bg-muted/50 text-left">
                {groups.map((g) => (
                  <th
                    key={g.regionId}
                    colSpan={g.span}
                    // 分けていない地域は、下の段まで貫いて1つのセルにする
                    rowSpan={g.expanded ? 1 : 2}
                    className={cn(CELL, "relative p-0 font-medium", g.expanded && "text-center")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleRegion(g.regionId)}
                      aria-expanded={g.expanded}
                      title={
                        g.expanded
                          ? `${g.label} — ${m.composition.aggregateGroupByRegion}`
                          : `${g.label} — ${m.composition.aggregateSplitByCategory}`
                      }
                      className={cn(
                        "hover:bg-accent/60 flex w-full items-center gap-1 px-2 py-1",
                        g.expanded ? "justify-center" : "text-left",
                      )}
                    >
                      <ChevronRight
                        className={cn(
                          "text-muted-foreground size-3 shrink-0 transition-transform",
                          g.expanded && "rotate-90",
                        )}
                      />
                      <span className="truncate">{g.label}</span>
                    </button>
                    {/* 分けていない地域の列は、ここが幅を変える場所になる */}
                    {!g.expanded &&
                      cols.handle(`region:${g.regionId}`, `${g.label} ${m.table.resize}`)}
                  </th>
                ))}
              </tr>

              <tr className="bg-muted/50 border-b text-left">
                {leaves
                  .filter((c) => c.categoryId !== null)
                  .map((c) => {
                    const picked = focus?.categoryId === c.categoryId;
                    return (
                      <th key={c.key} className={cn(CELL, "relative p-0 font-medium")}>
                        <button
                          type="button"
                          onClick={() =>
                            setFocus(
                              picked
                                ? null
                                : { categoryId: c.categoryId as string, label: c.label },
                            )
                          }
                          aria-pressed={picked}
                          title={`${c.label} — ${picked ? m.composition.aggregateShowAllRows : m.composition.aggregateOnlyThis}`}
                          className={cn(
                            "hover:bg-accent/60 flex w-full items-center px-2 py-1 text-left",
                            picked && "bg-accent text-foreground",
                          )}
                        >
                          <span className="truncate">{c.label}</span>
                        </button>
                        {cols.handle(c.key, `${c.label} ${m.table.resize}`)}
                      </th>
                    );
                  })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const key = keyOf(row);
                const many = row.contributions.length > 1;
                const shown = open.has(key);
                return (
                  <Fragment key={key}>
                    <tr className="border-b">
                      <td className={cn(CELL, "font-mono text-xs")}>
                        {row.casNumber ?? (
                          <span className="text-muted-foreground font-sans">
                            {m.composition.aggregateNoCas}
                          </span>
                        )}
                      </td>
                      <td className={cn(CELL, "font-mono text-xs")}>{row.code}</td>
                      <td className={CELL}>
                        {many ? (
                          <button
                            type="button"
                            onClick={() => toggle(key)}
                            aria-expanded={shown}
                            aria-label={
                              shown ? m.composition.collapse : m.composition.aggregateShowSources
                            }
                            className="hover:text-foreground -ml-1 inline-flex items-center gap-1 text-left"
                          >
                            <ChevronRight
                              className={cn(
                                "text-muted-foreground size-4 shrink-0 transition-transform",
                                shown && "rotate-90",
                              )}
                            />
                            {pickName(locale, row.nameJa, row.nameEn)}
                          </button>
                        ) : (
                          pickName(locale, row.nameJa, row.nameEn)
                        )}
                      </td>
                      <td className={cn(CELL, "text-right whitespace-nowrap")}>{row.totalPct}%</td>
                      {leaves.map((c) => {
                        const hit = row.regulations.filter((r) => c.categoryIds.has(r.categoryId));
                        return (
                          <td key={c.key} className={cn(CELL, "text-center")}>
                            <RegulationMark
                              hits={hit}
                              expanded={c.categoryId !== null}
                              locale={locale}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {/*
                     * 内訳は物質コードと、製品全体に対する重量%だけ。
                     * どの原材料から来たかは登録組成のほうを見れば分かる。
                     * 数字を上の行と同じ列に置くので、足すと合計になることが目で追える。
                     */}
                    {many &&
                      shown &&
                      row.contributions.map((c, i) => (
                        <tr key={`${key}-${i}`} className="bg-muted/40 border-b">
                          <td className={CELL} />
                          <td className={cn(CELL, "text-muted-foreground pl-6 font-mono text-xs")}>
                            {c.code}
                          </td>
                          {/* まとめる前の名前。代表と同じでも空欄にはしない（空欄は「入っていない」に見える） */}
                          <td className={cn(CELL, "text-muted-foreground pl-6 text-xs")}>
                            {pickName(locale, c.nameJa, c.nameEn)}
                          </td>
                          <td
                            className={cn(
                              CELL,
                              "text-muted-foreground text-right text-xs whitespace-nowrap",
                            )}
                          >
                            {c.pct}%
                          </td>
                          {leaves.map((c) => (
                            <td key={c.key} className={CELL} />
                          ))}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            {!focus && (
              <tfoot>
                <tr className="bg-muted/50 border-t">
                  <td className={cn(CELL, "text-right font-medium")} colSpan={3}>
                    {m.composition.sumLabel}
                  </td>
                  <td className={cn(CELL, "text-right font-medium")}>{data.totalPct}%</td>
                  {leaves.map((c) => (
                    <td key={c.key} className={CELL} />
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * その物質が、その列の規制に当たっているかどうかの印。
 *
 *   地域の列（まとめているとき） … **当たっている規制区分の個数**
 *   区分の列（分けたとき）       … 当たっていれば印、当たっていなければ空
 *
 * **空欄は「かかっていない」ではなく「該当が無い」。**
 * まだ判定していない製品でも空になるので、下の判定表と合わせて読む。
 *
 * 確認が残っている区分は、判定表と同じ赤にする。
 * 地域にまとめているときは、1つでも残っていれば赤くする
 * （まとめた中に見なければいけないものが隠れる、という事故を防ぐ）。
 */
function RegulationMark({
  hits,
  expanded,
  locale,
}: {
  hits: RowRegulationDto[];
  expanded: boolean;
  locale: ReturnType<typeof useI18n>["locale"];
}) {
  if (hits.length === 0) return <span className="text-muted-foreground">—</span>;
  const needsReview = hits.some((h) => h.needsReview);
  const title = hits
    .map(
      (h) =>
        `${pickStatutoryName(locale, h.lawNameOriginal, h.lawNameJa, h.lawNameEn)} › ${pickStatutoryName(locale, h.categoryNameOriginal, h.categoryNameJa, h.categoryNameEn)}`,
    )
    .join("\n");
  return (
    <span
      title={title}
      className={cn("tabular-nums", needsReview ? "text-destructive font-medium" : "")}
    >
      {expanded ? "●" : hits.length}
    </span>
  );
}
