"use client";

import type { Locale } from "@chem/shared";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { GhsClassDef, GhsClassificationRow, GhsSourceBlock } from "../ghs/query";
import { sdsMessages } from "../messages";

/**
 * 物質の詳細に出す GHS 分類（出典別、読み取り専用）。S23 §5-4 の比較の表。
 *
 * **左にクラス、右に出典の項目ごとの列。** 列は「いま効いている項目」と「これから効く項目」（将来の ATP は既定で出す）。
 * 見出しは 3 段（出典／項目の識別子と版／データ取得日）。行はカタログのクラス（いちばん細かい粒度）で、
 * 粗い粒度の値（EU の経路の記載なしの吸入）は専用の行に出し、勝手に細かい行へ振り分けない。
 *
 * セルは 1 行目が区分、その右に標的臓器（常に）、下に H コード・改訂版と年度（チェックで）。
 * 該当しない項目は出典の言葉、記載の無い項目は斜体の「データなし」（出典の言葉と情報が無いことを取り違えない）。
 * 該当どうしで区分の文字が出典間で違う行は黄色と ≠（読み替えは段 1 でできてから）
 */

/** 区分の日本語: カタログの名前が「〜 区分2」なら「区分2」、それ以外（液化ガス・等級1.1・追加区分（授乳））はそのまま */
function categoryLabel(r: GhsClassificationRow, ja: boolean, unspecified: string): string {
  if (r.category === "UNSPEC") return unspecified;
  if (!ja) return r.category;
  const name = r.categoryNameJa ?? r.category;
  const m = name.match(/区分[0-9A-Z.]+$/);
  return m ? m[0] : name;
}

interface RowModel {
  cls: GhsClassDef;
  /** 列ごとの分類（複数区分あり）。無ければ空 */
  cells: GhsClassificationRow[][];
  anyClassified: boolean;
  anyStated: boolean;
  differs: boolean;
}

export function SubstanceGhsSectionView({
  locale,
  blocks: allBlocks,
  classes,
}: {
  locale: Locale;
  blocks: GhsSourceBlock[];
  /** カタログの全クラス（表示の並び順） */
  classes: GhsClassDef[];
}) {
  const all = sdsMessages(locale);
  const t = all.ghs;
  const ja = locale === "ja";
  // 結び付きの層（LOLI など）で当たった列の付け外し。既定は出す
  const linkLayers = useMemo(
    () => [...new Set(allBlocks.map((b) => b.linkedBy).filter((x): x is string => !!x))],
    [allBlocks],
  );
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const blocks = useMemo(
    () => allBlocks.filter((b) => !b.linkedBy || !hiddenLayers.has(b.linkedBy)),
    [allBlocks, hiddenLayers],
  );
  const [showNotClassified, setShowNotClassified] = useState(false);
  const [showNoData, setShowNoData] = useState(false);
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [showHCodes, setShowHCodes] = useState(false);
  const [showRevision, setShowRevision] = useState(false);

  const rows = useMemo<RowModel[]>(
    () =>
      classes.map((cls) => {
        const cells = blocks.map((b) => b.rows.filter((r) => r.hazardClass === cls.code));
        const classified = cells.map((c) => c.filter((r) => r.status === "CLASSIFIED"));
        const keys = classified
          .filter((c) => c.length > 0)
          .map((c) =>
            c
              .map((r) => r.category)
              .sort()
              .join("|"),
          );
        return {
          cls,
          cells,
          anyClassified: keys.length > 0,
          anyStated: cells.some((c) => c.some((r) => r.status !== "NOT_EVALUATED")),
          differs: keys.length > 1 && new Set(keys).size > 1,
        };
      }),
    [blocks, classes],
  );
  const shown = rows.filter((r) => {
    if (showDiffOnly) return r.differs;
    if (r.anyClassified) return true;
    if (r.anyStated) return showNotClassified;
    return showNoData;
  });

  // 同じ出典に列が 2 本以上あるときだけ、版（現行／将来）を見出しに出す
  const perSource = new Map<string, number>();
  for (const b of blocks) perSource.set(b.sourceCode, (perSource.get(b.sourceCode) ?? 0) + 1);

  const check = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.section.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {check(t.section.showNotClassified, showNotClassified, setShowNotClassified)}
          {check(t.section.showNoData, showNoData, setShowNoData)}
          {check(t.section.showDiffOnly, showDiffOnly, setShowDiffOnly)}
          <span className="text-muted-foreground">|</span>
          {check(t.section.showHCodes, showHCodes, setShowHCodes)}
          {check(t.section.showRevision, showRevision, setShowRevision)}
          {linkLayers.length > 0 && <span className="text-muted-foreground">|</span>}
          {linkLayers.map((code) =>
            check(all.data.sourceShort[code] ?? code, !hiddenLayers.has(code), (v) =>
              setHiddenLayers((prev) => {
                const next = new Set(prev);
                if (v) next.delete(code);
                else next.add(code);
                return next;
              }),
            ),
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-max min-w-full border-collapse text-sm">
            <thead>
              <tr className="align-bottom">
                <th
                  scope="col"
                  className="bg-background sticky left-0 z-10 border-b px-2 py-1 text-left font-medium"
                >
                  {t.section.columns.hazardClass}
                </th>
                {blocks.map((b) => {
                  const version =
                    (perSource.get(b.sourceCode) ?? 0) > 1 || b.isFuture
                      ? b.isFuture
                        ? t.section.from(b.effectiveFrom)
                        : t.section.current
                      : null;
                  const act = b.amendingAct?.split(" ")[0];
                  const key = [b.sourceKey + b.subKey, b.conditionText ? "…%" : null, act]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <th
                      key={`${b.sourceCode}-${b.sourceKey}-${b.subKey}-${b.effectiveFrom}`}
                      scope="col"
                      className={cn(
                        "min-w-[8rem] border-b px-2 py-1 text-left font-normal",
                        b.isFuture && "text-muted-foreground",
                      )}
                      title={`${b.entryName}\n${b.releaseLabel}${b.linkNote ? `\n${b.linkNote}` : ""}`}
                    >
                      <div className="font-medium">
                        {ja ? b.sourceNameJa : b.sourceNameEn}
                        {b.linkedBy && (
                          <span className="text-primary ml-1 text-xs font-normal">
                            {all.data.layers.viaTag(all.data.sourceShort[b.linkedBy] ?? b.linkedBy)}
                          </span>
                        )}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {key}
                        {version && ` ・ ${version}`}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {t.section.acquiredShort(
                          new Date(b.lastSeenImportedAt).toLocaleDateString(locale),
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.cls.code} className="border-b align-top">
                  <th
                    scope="row"
                    className="bg-background sticky left-0 z-10 px-2 py-1 text-left font-normal whitespace-nowrap"
                  >
                    {ja ? row.cls.nameJa : row.cls.nameEn}
                    {row.differs && (
                      <span
                        className="ml-1 text-amber-700 dark:text-amber-400"
                        title={t.section.differs}
                      >
                        ≠
                      </span>
                    )}
                  </th>
                  {row.cells.map((cell, i) => (
                    <td
                      key={i}
                      className={cn(
                        "px-2 py-1",
                        row.differs &&
                          cell.some((r) => r.status === "CLASSIFIED") &&
                          "bg-amber-100/60 dark:bg-amber-900/30",
                      )}
                    >
                      {cell.length === 0 ? (
                        <span className="text-muted-foreground/70 italic">
                          {t.status.NOT_EVALUATED}
                        </span>
                      ) : (
                        cell.map((r) => (
                          <div key={`${r.hazardClass}|${r.category}`} title={r.rawClassText}>
                            {r.status === "CLASSIFIED" ? (
                              <>
                                <span className="font-medium">
                                  {categoryLabel(r, ja, t.section.classifiedUnspecified)}
                                </span>
                                {r.minimumClassification && (
                                  <sup className="text-muted-foreground ml-0.5">
                                    {r.minimumClassification}
                                  </sup>
                                )}
                                {r.targetOrgans && (
                                  <span className="text-muted-foreground ml-1 text-xs">
                                    {r.targetOrgans}
                                  </span>
                                )}
                                {showHCodes && r.hCodes && (
                                  <div className="text-muted-foreground text-xs tabular-nums">
                                    {r.hCodes.replaceAll(",", " ")}
                                  </div>
                                )}
                                {showRevision && (r.ghsRevision || r.classifiedIn) && (
                                  <div className="text-muted-foreground text-xs">
                                    {t.section.revisionLine(r.ghsRevision, r.classifiedIn)}
                                  </div>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-muted-foreground">{t.status[r.status]}</span>
                                {showRevision && (r.ghsRevision || r.classifiedIn) && (
                                  <div className="text-muted-foreground text-xs">
                                    {t.section.revisionLine(r.ghsRevision, r.classifiedIn)}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">{t.section.legend}</p>
      </CardContent>
    </Card>
  );
}
