"use client";

import { pickName } from "@chem/shared";
import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, CompositionAggregateDto } from "@/lib/types";
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

export function CompositionAggregateTable({ productId }: { productId: string }) {
  const { m, locale } = useI18n();
  const [data, setData] = useState<CompositionAggregateDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

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

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!data) return <p className="text-muted-foreground text-sm">{m.common.loading}</p>;

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/50 border-y text-left">
                <th className={cn(CELL, "w-32 font-medium")}>{m.composition.casNumber}</th>
                <th className={cn(CELL, "w-28 font-medium")}>
                  {m.composition.aggregateSubstanceId}
                </th>
                <th className={cn(CELL, "font-medium")}>{m.composition.aggregateName}</th>
                <th className={cn(CELL, "w-px text-right font-medium whitespace-nowrap")}>
                  {m.composition.contentPct}
                </th>
                <th className={cn(CELL, "w-20 text-right font-medium")}>
                  {m.composition.aggregateSources}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const key = row.casNumber ?? row.code;
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
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
