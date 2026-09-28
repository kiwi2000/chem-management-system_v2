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
import type { GhsClassDef, GhsClassificationRow, GhsSourceBlock } from "../ghs/query";
import { sdsMessages } from "../messages";

/**
 * 物質の詳細に出す GHS 分類（出どころ別、読み取り専用）。
 * 既定では「該当」だけを見せ、ボタンで全項目を出す（NITE は 35 項目すべてに値があるので、全部出すと長いため）。
 * 「状態」の列は持たない。区分の列に、該当なら区分、出典が「該当しない」「分類できない」等と書いていればその言葉、
 * 出典に何も無ければ「記載なし」を出し、**出典の言葉と、情報が無いこととを取り違えない**ようにする（2026-09-28 指示）
 */
/** 区分の日本語: カタログの名前が「〜 区分2」なら「区分2」、それ以外（液化ガス・等級1.1・追加区分（授乳））はそのまま */
function categoryLabelJa(r: GhsClassificationRow): string {
  const name = r.categoryNameJa ?? r.category;
  const m = name.match(/区分[0-9A-Z.]+$/);
  return m ? m[0] : name;
}

export function SubstanceGhsSectionView({
  locale,
  asOf,
  blocks,
  classes,
}: {
  locale: Locale;
  asOf: string;
  blocks: GhsSourceBlock[];
  /** カタログの全クラス（表示の並び順）。全項目を出すときの骨組み */
  classes: GhsClassDef[];
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
          const rows: GhsClassificationRow[] = showAll
            ? classes.flatMap((c) => {
                const have = b.rows.filter((r) => r.hazardClass === c.code);
                if (have.length > 0) return have;
                // 出典がこの項目に何も書いていない
                return [
                  {
                    hazardClass: c.code,
                    classNameJa: c.nameJa,
                    classNameEn: c.nameEn,
                    category: "",
                    categoryNameJa: null,
                    categoryNameEn: null,
                    status: "NOT_EVALUATED" as const,
                    hCodes: null,
                    targetOrgans: null,
                    ghsRevision: null,
                    classifiedIn: null,
                    rawClassText: "",
                  },
                ];
              })
            : b.rows.filter((r) => r.status === "CLASSIFIED");
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
                        {r.status === "CLASSIFIED" ? (
                          ja ? (
                            categoryLabelJa(r)
                          ) : (
                            r.category
                          )
                        ) : r.status === "NOT_EVALUATED" ? (
                          <span className="text-muted-foreground/70 italic">
                            {t.status.NOT_EVALUATED}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {r.rawClassText || t.status[r.status]}
                          </span>
                        )}
                      </TableCell>
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
        {showAll && <p className="text-muted-foreground text-xs">{t.section.legend}</p>}
      </CardContent>
    </Card>
  );
}
