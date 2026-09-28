"use client";

import type { Locale } from "@chem/shared";
import { useState } from "react";
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
 * 既定では「該当」だけを見せる。チェックボックス「非該当」で、出典に記載はあるが区分が付かない項目
 * （区分に該当しない・分類できない・分類対象外）を、「データなし」で、出典に記載の無い項目を足す（2026-09-28 指示）。
 * 「状態」の列は持たない。区分の列に、該当なら区分、非該当ならその言葉、データなしなら斜体の「データなし」を出し、
 * **出典の言葉と、情報が無いこととを取り違えない**ようにする
 */
/** 区分の日本語: カタログの名前が「〜 区分2」なら「区分2」、それ以外（液化ガス・等級1.1・追加区分（授乳））はそのまま */
function categoryLabelJa(r: GhsClassificationRow): string {
  const name = r.categoryNameJa ?? r.category;
  const m = name.match(/区分[0-9A-Z.]+$/);
  return m ? m[0] : name;
}

export function SubstanceGhsSectionView({
  locale,
  blocks,
  classes,
}: {
  locale: Locale;
  blocks: GhsSourceBlock[];
  /** カタログの全クラス（表示の並び順）。全項目を出すときの骨組み */
  classes: GhsClassDef[];
}) {
  const t = sdsMessages(locale).ghs;
  const [showNotClassified, setShowNotClassified] = useState(false);
  const [showNoData, setShowNoData] = useState(false);
  const ja = locale === "ja";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.section.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showNotClassified}
              onChange={(e) => setShowNotClassified(e.target.checked)}
            />
            {t.section.showNotClassified}
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showNoData}
              onChange={(e) => setShowNoData(e.target.checked)}
            />
            {t.section.showNoData}
          </label>
        </div>
        {blocks.map((b) => {
          // クラスの並びで組み立てる。出典に無いクラスは「データなし」の行として補う
          const rows: GhsClassificationRow[] = classes
            .flatMap((c) => {
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
            .filter(
              (r) =>
                r.status === "CLASSIFIED" ||
                (r.status === "NOT_EVALUATED" ? showNoData : showNotClassified),
            );
          return (
            <div key={`${b.sourceCode}-${b.sourceKey}`} className="space-y-1">
              <p className="text-sm font-medium">
                {ja ? b.sourceNameJa : b.sourceNameEn}
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  {b.sourceKey} ・ {b.entryName}
                </span>
                <span className="text-muted-foreground ml-2 text-xs font-normal">
                  {t.section.acquired(
                    new Date(b.lastSeenImportedAt).toLocaleDateString(locale),
                    b.lastSeenLabel,
                    b.lastSeenPublishedOn,
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
                          <span className="text-muted-foreground">{t.status[r.status]}</span>
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
        {(showNotClassified || showNoData) && (
          <p className="text-muted-foreground text-xs">{t.section.legend}</p>
        )}
      </CardContent>
    </Card>
  );
}
