"use client";

import type { Locale } from "@chem/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GhsSourceBlock } from "../ghs/query";
import { sdsMessages } from "../messages";

/**
 * 物質の詳細に出す GHS 分類（出どころ別、読み取り専用）。
 * 既定では「該当」だけを見せ、ボタンで「該当しない・分類できない・対象外・未評価」も出す
 * （NITE は 35 項目すべてに値があるので、全部出すと長いため）
 */
export function SubstanceGhsSectionView({
  locale,
  asOf,
  blocks,
}: {
  locale: Locale;
  asOf: string;
  blocks: GhsSourceBlock[];
}) {
  const t = sdsMessages(locale).ghs;
  const [showAll, setShowAll] = useState(false);
  const ja = locale === "ja";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t.section.title}
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {t.section.asOf(asOf)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? t.section.showClassifiedOnly : t.section.showAll}
          </Button>
        </div>
        {blocks.map((b) => {
          const rows = showAll ? b.rows : b.rows.filter((r) => r.status === "CLASSIFIED");
          return (
            <div key={`${b.sourceCode}-${b.sourceKey}`} className="space-y-1">
              <p className="text-sm font-medium">
                {ja ? b.sourceNameJa : b.sourceNameEn}
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  {b.sourceKey} ・ {b.entryName}
                </span>
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  {t.section.lastConfirmed(
                    b.lastSeenLabel,
                    b.lastSeenPublishedOn,
                    new Date(b.lastSeenImportedAt).toLocaleDateString(locale),
                  )}
                </span>
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.section.columns.hazardClass}</TableHead>
                    <TableHead>{t.section.columns.category}</TableHead>
                    <TableHead>{t.section.columns.status}</TableHead>
                    <TableHead>{t.section.columns.hCodes}</TableHead>
                    <TableHead>{t.section.columns.targetOrgans}</TableHead>
                    <TableHead>{t.section.columns.revision}</TableHead>
                    <TableHead>{t.section.columns.classifiedIn}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={`${r.hazardClass}|${r.category}`}>
                      <TableCell>{ja ? r.classNameJa : r.classNameEn}</TableCell>
                      <TableCell>
                        {r.category
                          ? ja
                            ? (r.categoryNameJa?.replace(/^.*区分/, "区分") ?? r.category)
                            : r.category
                          : ""}
                      </TableCell>
                      <TableCell>{t.status[r.status]}</TableCell>
                      <TableCell className="tabular-nums">
                        {r.hCodes?.replaceAll(",", " ") ?? ""}
                      </TableCell>
                      <TableCell>{r.targetOrgans ?? ""}</TableCell>
                      <TableCell className="tabular-nums">{r.ghsRevision ?? ""}</TableCell>
                      <TableCell>{r.classifiedIn ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
