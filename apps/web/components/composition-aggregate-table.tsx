"use client";

import { pickName, pickStatutoryName } from "@chem/shared";
import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useResizableColumns } from "@/components/data-table/resizable-columns";
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
  { key: "casNumber", width: 128, label: (m) => m.composition.casNumber },
  { key: "substanceId", width: 112, label: (m) => m.composition.aggregateSubstanceId },
  { key: "name", width: 256, label: (m) => m.composition.aggregateName },
  {
    key: "contentPct",
    width: 80,
    label: (m) => m.composition.contentPct,
    className: "text-right whitespace-nowrap",
  },
  {
    key: "sources",
    width: 80,
    label: (m) => m.composition.aggregateSources,
    className: "text-right",
  },
  // この物質がどの法令に引っかかっているか。判定表と向きが逆で、
  // 組成を見ながら「これが原因だ」とたどれる
  { key: "regulations", width: 288, label: (m) => m.composition.aggregateRegulations },
];

export function CompositionAggregateTable({
  productId,
  open,
  onOpenChange,
  onExpandableChange,
}: Props) {
  const { m, locale } = useI18n();
  const [data, setData] = useState<CompositionAggregateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 列幅は一覧と同じ規則
  const cols = useResizableColumns("chem.table.compositionAggregate", HEADS);

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

  const toggle = (key: string) => {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onOpenChange(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">{m.composition.aggregateLead}</p>

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

      {data.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{m.composition.empty}</p>
      ) : (
        <div ref={cols.scrollerRef} className="overflow-x-auto">
          <table
            className="w-full table-fixed border-collapse text-sm"
            style={{ minWidth: cols.minTableWidth }}
          >
            <colgroup>{cols.cols()}</colgroup>
            <thead>
              <tr className="bg-muted/50 border-y text-left">
                {HEADS.map(({ key, label, className }) => (
                  <th key={key} className={cn(CELL, "relative font-medium", className)}>
                    {label(m)}
                    {cols.handle(key, `${label(m)} ${m.table.resize}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
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
                      <td className={cn(CELL, "text-muted-foreground text-right text-xs")}>
                        {many ? m.composition.aggregateCount(row.contributions.length) : "—"}
                      </td>
                      <td className={cn(CELL, "max-w-0")}>
                        <RegulationChips items={row.regulations} locale={locale} />
                      </td>
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
                          <td className={CELL} />
                          <td className={CELL} />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/50 border-t">
                <td className={cn(CELL, "text-right font-medium")} colSpan={3}>
                  {m.composition.sumLabel}
                </td>
                <td className={cn(CELL, "text-right font-medium")}>{data.totalPct}%</td>
                <td className={CELL} />
                <td className={CELL} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * その物質が引っかかっている規制。**法律ごとにまとめて1行に収める。**
 *
 * 区分名をそのまま並べると、1物質で6個並ぶことがあり
 * （キシレンは化審法・安衛法3つ・毒劇法・化管法）、
 * 組成の並びが読めなくなる。この表は「何がどれだけ入っているか」を見るためのもので、
 * 規制の中身は下の判定表が受け持つ。ここは**目印**に徹する。
 *
 * 区分が1つだけなら区分名まで出す（そのほうが分かるので）。
 * 2つ以上なら数だけにして、区分名は触れれば読める。
 *
 * **空欄は「かかっていない」ではなく「該当が無い」。**
 * まだ判定していない製品でも空になるので、下の判定表と合わせて読む。
 */
function RegulationChips({
  items,
  locale,
}: {
  items: RowRegulationDto[];
  locale: ReturnType<typeof useI18n>["locale"];
}) {
  if (items.length === 0) return <span className="text-muted-foreground">—</span>;

  /** 法律ごとにまとめる。並びは元のまま（法令 → 区分の順に入っている） */
  const byLaw = new Map<string, { law: string; categories: string[]; needsReview: boolean }>();
  for (const r of items) {
    const law = pickStatutoryName(locale, r.lawNameOriginal, r.lawNameJa, r.lawNameEn);
    const category = pickStatutoryName(
      locale,
      r.categoryNameOriginal,
      r.categoryNameJa,
      r.categoryNameEn,
    );
    const found = byLaw.get(law) ?? { law, categories: [], needsReview: false };
    found.categories.push(category);
    // 1つでも確認が残っていれば、その法律の印に付ける
    found.needsReview = found.needsReview || r.needsReview;
    byLaw.set(law, found);
  }

  return (
    // 入りきらないぶんはセルの中だけ横に送る。スクロールバーは出さない
    <div className="flex gap-1 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {[...byLaw.values()].map((g) => (
        <span
          key={g.law}
          title={g.categories.map((c) => `${g.law} › ${c}`).join("\n")}
          className={cn(
            "shrink-0 rounded border px-1.5 py-0.5 text-xs",
            // 確認が残っている法律は、判定表と同じ色で目印を付ける
            g.needsReview ? "border-destructive/40 text-destructive" : "text-muted-foreground",
          )}
        >
          {g.law}
          {g.categories.length === 1 ? (
            <span className="ml-1 opacity-70">{g.categories[0]}</span>
          ) : (
            <span className="ml-1 font-medium tabular-nums">{g.categories.length}</span>
          )}
        </span>
      ))}
    </div>
  );
}
