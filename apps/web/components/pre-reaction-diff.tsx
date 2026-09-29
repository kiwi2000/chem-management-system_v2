"use client";

import { pickName } from "@chem/shared";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { CompositionDiffDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 反応前との差分（S24 §3）。「組成（反応後）」のカードの、原材料展開・CAS 合算の表の下に出す。
 * 消えた・生じた・変わった物質と、金属換算係数で見た元素の量の照合。
 * 反応後を直しているあいだは出さない（保存してから）。`refreshKey` が変わると引き直す
 */
export function PreReactionDiff({
  productId,
  refreshKey,
}: {
  productId: string;
  refreshKey: string;
}) {
  const { m, locale } = useI18n();
  const t = m.composition.postReaction.diff;
  const [data, setData] = useState<CompositionDiffDto | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch(`/api/products/${productId}/composition/diff`);
      if (!res.ok) {
        redirectIfUnauthorized(res);
        return;
      }
      const body = (await res.json()) as CompositionDiffDto;
      if (alive) setData(body);
    })();
    return () => {
      alive = false;
    };
  }, [productId, refreshKey]);

  if (data === null) {
    return (
      <div className="space-y-1 border-t pt-4">
        <p className="text-sm font-medium">{t.title}</p>
        <p className="text-muted-foreground text-sm">{m.common.loading}</p>
      </div>
    );
  }
  const none = data.removed.length === 0 && data.added.length === 0 && data.changed.length === 0;
  const mismatches = data.elements.filter((e) => e.mismatch);
  const name = (r: { nameJa: string; nameEn: string | null }) =>
    pickName(locale, r.nameJa, r.nameEn);
  const pct = (s: string) => `${s}%`;

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-sm font-medium">{t.title}</p>
      {(data.blockedBefore > 0 || data.blockedAfter > 0) && (
        <p className="text-destructive text-xs">{t.blocked}</p>
      )}
      {none ? (
        <p className="text-muted-foreground text-sm">{t.same}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <DiffList
            title={t.removed}
            empty={t.none}
            rows={data.removed.map((r) => ({
              key: r.code,
              cas: r.casNumber,
              name: name(r),
              value: pct(r.beforePct),
            }))}
            valueHead={t.beforePct}
          />
          <DiffList
            title={t.added}
            empty={t.none}
            rows={data.added.map((r) => ({
              key: r.code,
              cas: r.casNumber,
              name: name(r),
              value: pct(r.afterPct),
            }))}
            valueHead={t.afterPct}
          />
          <DiffList
            title={t.changed}
            empty={t.none}
            rows={data.changed.map((r) => ({
              key: r.code,
              cas: r.casNumber,
              name: name(r),
              value: `${r.beforePct}% → ${r.afterPct}% (${Number(r.delta) > 0 ? "+" : ""}${r.delta})`,
            }))}
            valueHead={t.beforeAfter}
          />
        </div>
      )}
      {data.elements.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm">
            {t.elements}
            {mismatches.length > 0 ? (
              <span className="text-destructive ml-2 inline-flex items-center gap-1 text-xs">
                <TriangleAlert className="size-3" />
                {t.elementMismatch(mismatches.length)}
              </span>
            ) : (
              <span className="text-muted-foreground ml-2 text-xs">{t.elementOk}</span>
            )}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.element}</TableHead>
                <TableHead className="text-right">{t.beforePct}</TableHead>
                <TableHead className="text-right">{t.afterPct}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.elements.map((e) => (
                <TableRow key={e.element} className={cn(e.mismatch && "text-destructive")}>
                  <TableCell className="font-medium">{e.element}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(e.beforePct)}</TableCell>
                  <TableCell className="text-right tabular-nums">{pct(e.afterPct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground text-xs">{t.elementHint}</p>
        </div>
      )}
    </div>
  );
}

function DiffList({
  title,
  empty,
  rows,
  valueHead,
}: {
  title: string;
  empty: string;
  rows: { key: string; cas: string | null; name: string; value: string }[];
  valueHead: string;
}) {
  const { m } = useI18n();
  return (
    <div className="space-y-1">
      <p className="text-sm">
        {title}
        <span className="text-muted-foreground ml-1 text-xs">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-xs">{empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{m.composition.casNumber}</TableHead>
              <TableHead>{m.composition.aggregateName}</TableHead>
              <TableHead className="text-right">{valueHead}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="whitespace-nowrap">{r.cas ?? m.composition.noCas}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">
                  {r.value}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
