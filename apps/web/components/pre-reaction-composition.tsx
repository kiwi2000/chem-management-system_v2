"use client";

import { pickName } from "@chem/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n-client";
import type { PreReactionDto } from "@/lib/types";

/**
 * 反応前の組成（S24）。「反応後の組成入力」を押した時点の登録組成の写しを、**表示だけ**する。
 * 判定・合算・出力は上の「組成（反応後）」を使う。列は登録組成と同じ 5 つ
 */
export function PreReactionComposition({ data }: { data: PreReactionDto }) {
  const { m, locale } = useI18n();
  const t = m.composition;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{t.postReaction.beforeTitle}</CardTitle>
        <span className="text-muted-foreground text-xs">
          {t.postReaction.copiedAt(new Date(data.at).toLocaleString(locale), data.byName)}
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-muted-foreground text-xs">{t.postReaction.beforeHint}</p>
        {data.lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.elementId}</TableHead>
                <TableHead>{t.casNumber}</TableHead>
                <TableHead>{t.elementName}</TableHead>
                <TableHead className="text-right">{t.contentPct}</TableHead>
                <TableHead>{t.note}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="whitespace-nowrap">
                    {l.element?.code ?? "－"}
                    {l.childProductId && (
                      <span className="text-muted-foreground ml-1 text-xs">{t.kindProduct}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {l.element?.casNumber ?? t.noCas}
                  </TableCell>
                  <TableCell>
                    {l.element ? pickName(locale, l.element.nameJa, l.element.nameEn) : "－"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{l.contentPct ?? ""}</TableCell>
                  <TableCell>{l.note ?? ""}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/50">
                <TableCell colSpan={3} className="text-right font-medium">
                  {t.sumLabel}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {data.totalPct}%
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
