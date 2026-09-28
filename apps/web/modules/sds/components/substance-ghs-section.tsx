"use client";

import type { Locale } from "@chem/shared";
import { CircleHelp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import type { ApiError } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GHS_CATALOG } from "../ghs/catalog-data";
import { DEFAULT_COUNTRY, SDS_COUNTRIES, countryName } from "../ghs/countries";
import type { AdoptedCellDto, GhsDataRowDto, GhsStatus, OverrideDto } from "../ghs/data-dto";
import type { GhsClassDef, GhsClassificationRow, GhsSourceBlock } from "../ghs/query";
import { sdsMessages } from "../messages";

/**
 * 物質の詳細に出す GHS 分類（出典別）。S23 §5-4 の比較の表に、§9-5 で「採用」の列と「判定修正」を足した
 * （法規制判定と同じ形: 左に採用結果、右に根拠＝出典ごとの列、行末に判定修正）。
 *
 * **左にクラス、次に採用、右に出典の項目ごとの列。** 列は「いま効いている項目」と「これから効く項目」（将来の ATP は既定で出す）。
 * 見出しは 3 段（出典／項目の識別子と版／データ取得日）。行はカタログのクラス（いちばん細かい粒度）で、
 * 粗い粒度の値（EU の経路の記載なしの吸入）は専用の行に出し、勝手に細かい行へ振り分けない。
 *
 * 採用の結果は API（GET ghs-data）から引く。画面で別の計算をしない（一覧・SDS と同じ関数で決めるため）。
 * 採用した項目のセルは通常の字、採用しなかった該当の値は薄い字（データはあるが採用していない）。
 * 条件付きの項目（濃度・形態）が当たる行は「要確認」の印。自社判定は「判定修正」で行の中に入力欄が開く
 */

/** 区分の日本語: カタログの名前が「〜 区分2」なら「区分2」、それ以外（液化ガス・等級1.1・追加区分（授乳））はそのまま */
function categoryLabel(r: GhsClassificationRow, ja: boolean, unspecified: string): string {
  if (r.category === "UNSPEC") return unspecified;
  if (!ja) return r.category;
  const name = r.categoryNameJa ?? r.category;
  const m = name.match(/区分[0-9A-Z.]+$/);
  return m ? m[0] : name;
}

/** 採用の列の区分（カタログの名前から） */
function adoptedCategoryLabel(
  hazardClass: string,
  category: string,
  ja: boolean,
  unspecified: string,
) {
  if (category === "UNSPEC") return unspecified;
  if (!ja) return category;
  const name =
    GHS_CATALOG.find((c) => c.code === hazardClass)?.categories.find((k) => k.category === category)
      ?.nameJa ?? `区分${category}`;
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

/** 選んだ国を端末に覚える（GHS データの表と同じ鍵） */
const COUNTRY_KEY = "chem.sds.ghsData.country";

const CHOICES: GhsStatus[] = ["CLASSIFIED", "NOT_CLASSIFIED", "CANNOT_CLASSIFY", "NOT_APPLICABLE"];

export function SubstanceGhsSectionView({
  locale,
  blocks: allBlocks,
  classes,
  substanceId,
  substanceCode,
  canEdit,
}: {
  locale: Locale;
  blocks: GhsSourceBlock[];
  /** カタログの全クラス（表示の並び順） */
  classes: GhsClassDef[];
  substanceId: string;
  substanceCode: string;
  /** 判定修正（自社判定）ができるか */
  canEdit: boolean;
}) {
  const all = sdsMessages(locale);
  const t = all.ghs;
  const te = all.data.edit;
  const ja = locale === "ja";
  // 結び付きの層（LOLI など）で当たった列の付け外し。既定は出す。採用の計算にも同じ層を使う
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

  // SDS の対象の国と、その国の採用結果（API から）
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COUNTRY_KEY);
      if (saved && SDS_COUNTRIES.some((c) => c.code === saved)) setCountry(saved);
    } catch {
      /* 端末の保存領域が使えないときは既定のまま */
    }
  }, []);
  const chooseCountry = (c: string) => {
    setCountry(c);
    try {
      localStorage.setItem(COUNTRY_KEY, c);
    } catch {
      /* 覚えられなくても動く */
    }
  };
  const [adopted, setAdopted] = useState<Record<string, AdoptedCellDto> | null>(null);
  const [overrides, setOverrides] = useState<OverrideDto[]>([]);
  const layersParam = useMemo(
    () => [...linkLayers.filter((l) => !hiddenLayers.has(l)), "OVERRIDE"].join(","),
    [linkLayers, hiddenLayers],
  );
  const load = useCallback(async () => {
    const [a, o] = await Promise.all([
      fetch(
        `/api/modules/sds/ghs-data?f.code=${encodeURIComponent(`equals:${substanceCode}`)}&country=${encodeURIComponent(country)}&layers=${encodeURIComponent(layersParam)}`,
      ),
      fetch(`/api/modules/sds/ghs-data/overrides?substanceId=${encodeURIComponent(substanceId)}`),
    ]);
    if (!a.ok || !o.ok) {
      redirectIfUnauthorized(a.ok ? o : a);
      return;
    }
    const rows = ((await a.json()) as { items: GhsDataRowDto[] }).items;
    setAdopted(rows.find((r) => r.id === substanceId)?.cells ?? {});
    setOverrides(((await o.json()) as { items: OverrideDto[] }).items);
  }, [substanceCode, substanceId, country, layersParam]);
  useEffect(() => {
    void load();
  }, [load]);

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
    const a = adopted?.[r.cls.code];
    if (showDiffOnly) return r.differs;
    if (r.anyClassified || a?.status === "CLASSIFIED" || a?.review) return true;
    if (r.anyStated || (a && a.status !== "NOT_EVALUATED")) return showNotClassified;
    return showNoData;
  });

  // 同じ出典に列が 2 本以上あるときだけ、版（現行／将来）を見出しに出す
  const perSource = new Map<string, number>();
  for (const b of blocks) perSource.set(b.sourceCode, (perSource.get(b.sourceCode) ?? 0) + 1);

  const check = (label: string, value: boolean, set: (v: boolean) => void, key?: string) => (
    <label key={key} className="flex items-center gap-1.5">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  /** その列の項目が、この行で採用されているか */
  const isAdoptedBlock = (b: GhsSourceBlock, a: AdoptedCellDto | undefined) =>
    !!a && a.from === b.sourceCode && a.via?.entryKey === b.sourceKey + b.subKey;

  // 判定修正（行の中に開く）
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.section.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            {all.data.country}
            <select
              value={country}
              onChange={(e) => chooseCountry(e.target.value)}
              className="border-input bg-background h-7 rounded-none border px-1 text-sm"
            >
              {SDS_COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name[locale]}
                </option>
              ))}
            </select>
          </label>
          <span className="text-muted-foreground">|</span>
          {check(t.section.showNotClassified, showNotClassified, setShowNotClassified)}
          {check(t.section.showNoData, showNoData, setShowNoData)}
          {check(t.section.showDiffOnly, showDiffOnly, setShowDiffOnly)}
          <span className="text-muted-foreground">|</span>
          {check(t.section.showHCodes, showHCodes, setShowHCodes)}
          {check(t.section.showRevision, showRevision, setShowRevision)}
          {linkLayers.length > 0 && <span className="text-muted-foreground">|</span>}
          {linkLayers.map((code) =>
            check(
              all.data.sourceShort[code] ?? code,
              !hiddenLayers.has(code),
              (v) =>
                setHiddenLayers((prev) => {
                  const next = new Set(prev);
                  if (v) next.delete(code);
                  else next.add(code);
                  return next;
                }),
              code,
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
                <th scope="col" className="min-w-[9rem] border-b px-2 py-1 text-left font-medium">
                  {t.section.adoptedCol}
                  <div className="text-muted-foreground text-xs font-normal">
                    {countryName(country, locale)}
                  </div>
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
                        {b.conditionText && ` ・ ${b.conditionText}`}
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
                {canEdit && <th scope="col" className="border-b px-2 py-1" />}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const a = adopted?.[row.cls.code];
                return (
                  <Row
                    key={row.cls.code}
                    row={row}
                    adopted={a}
                    blocks={blocks}
                    isAdoptedBlock={isAdoptedBlock}
                    ja={ja}
                    locale={locale}
                    t={t}
                    all={all}
                    showHCodes={showHCodes}
                    showRevision={showRevision}
                    canEdit={canEdit}
                    editing={editing === row.cls.code}
                    onEdit={() => setEditing(editing === row.cls.code ? null : row.cls.code)}
                    editor={
                      editing === row.cls.code ? (
                        <OverrideRowEditor
                          locale={locale}
                          substanceId={substanceId}
                          hazardClass={row.cls.code}
                          country={country}
                          overrides={overrides}
                          colSpan={2 + blocks.length + 1}
                          onClose={() => setEditing(null)}
                          onSaved={() => {
                            setEditing(null);
                            void load();
                          }}
                        />
                      ) : null
                    }
                    te={te}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-muted-foreground text-xs">{t.section.legend}</p>
      </CardContent>
    </Card>
  );
}

type Msgs = ReturnType<typeof sdsMessages>;

function Row({
  row,
  adopted,
  blocks,
  isAdoptedBlock,
  ja,
  t,
  all,
  showHCodes,
  showRevision,
  canEdit,
  editing,
  onEdit,
  editor,
}: {
  row: RowModel;
  adopted: AdoptedCellDto | undefined;
  blocks: GhsSourceBlock[];
  isAdoptedBlock: (b: GhsSourceBlock, a: AdoptedCellDto | undefined) => boolean;
  ja: boolean;
  locale: Locale;
  t: Msgs["ghs"];
  all: Msgs;
  te: Msgs["data"]["edit"];
  showHCodes: boolean;
  showRevision: boolean;
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  editor: React.ReactNode;
}) {
  const a = adopted;
  const from = a?.from ? (all.data.sourceShort[a.from] ?? a.from) : "";
  const via = a?.via?.linkedBy ? `·${all.data.sourceShort[a.via.linkedBy] ?? a.via.linkedBy}` : "";
  return (
    <>
      <tr className="border-b align-top">
        <th
          scope="row"
          className="bg-background sticky left-0 z-10 px-2 py-1 text-left font-normal whitespace-nowrap"
        >
          {ja ? row.cls.nameJa : row.cls.nameEn}
          {row.differs && (
            <span className="ml-1 text-amber-700 dark:text-amber-400" title={t.section.differs}>
              ≠
            </span>
          )}
        </th>
        {/* 採用: 一覧と同じ見せ方（区分＋出典の印。自社判定は色付き。条件付きは要確認） */}
        <td className={cn("px-2 py-1", a?.from === "OVERRIDE" && "text-primary")}>
          {!a || a.status === "NOT_EVALUATED" ? (
            <span className="text-muted-foreground/70 italic">{t.status.NOT_EVALUATED}</span>
          ) : a.status !== "CLASSIFIED" ? (
            <span className="text-muted-foreground">{t.status[a.status]}</span>
          ) : (
            <span className="font-medium">
              {a.items.map((it, i) => (
                <span key={it.category}>
                  {i > 0 && "、"}
                  {adoptedCategoryLabel(
                    row.cls.code,
                    it.category,
                    ja,
                    t.section.classifiedUnspecified,
                  )}
                  {it.targetOrgans && (
                    <span className="text-muted-foreground ml-1 text-xs font-normal">
                      {it.targetOrgans}
                    </span>
                  )}
                </span>
              ))}
            </span>
          )}
          {a && a.status !== "NOT_EVALUATED" && (
            <span
              className={cn("ml-1 text-[10px]", via ? "text-primary" : "text-muted-foreground")}
              title={
                a.from === "OVERRIDE" && a.reason
                  ? t.section.overrideReason(a.reason)
                  : a.via?.linkedBy
                    ? all.data.layers.viaTitle(a.via.linkedBy, a.via.entryKey, a.via.entryName)
                    : undefined
              }
            >
              {from}
              {via}
            </span>
          )}
          {a?.review && (
            <span
              className="ml-1 inline-flex items-center gap-0.5 align-middle text-xs text-red-700 dark:text-red-400"
              title={t.section.reviewHint(
                a.review
                  .map(
                    (r) =>
                      `${r.entryKey} ${r.entryName}${r.condition !== r.entryName ? `（${r.condition}）` : ""}`,
                  )
                  .join("、"),
              )}
            >
              <CircleHelp className="size-3" />
              {t.section.needsReview}
            </span>
          )}
        </td>
        {row.cells.map((cell, i) => {
          const b = blocks[i]!;
          const adoptedHere = isAdoptedBlock(b, a);
          return (
            <td
              key={i}
              className={cn(
                "px-2 py-1",
                row.differs &&
                  cell.some((r) => r.status === "CLASSIFIED") &&
                  "bg-amber-100/60 dark:bg-amber-900/30",
              )}
              title={
                cell.length > 0 && !adoptedHere && a && a.status !== "NOT_EVALUATED"
                  ? t.section.notAdopted
                  : undefined
              }
            >
              {cell.length === 0 ? (
                <span className="text-muted-foreground/70 italic">{t.status.NOT_EVALUATED}</span>
              ) : (
                cell.map((r) => (
                  <div key={`${r.hazardClass}|${r.category}`} title={r.rawClassText}>
                    {r.status === "CLASSIFIED" ? (
                      <>
                        <span
                          className={cn(
                            "font-medium",
                            !adoptedHere &&
                              a &&
                              a.status !== "NOT_EVALUATED" &&
                              "text-muted-foreground font-normal",
                          )}
                        >
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
          );
        })}
        {canEdit && (
          <td className="px-2 py-1 whitespace-nowrap">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={onEdit}
              aria-expanded={editing}
            >
              {t.section.correct}
            </Button>
          </td>
        )}
      </tr>
      {editor}
    </>
  );
}

/**
 * 判定修正の欄（行の中に開く）。法規制判定の「判定修正」と同じ形。
 * 保存は「その物質 × 効く国」の上書きを丸ごと置き換える API なので、
 * 登録済みのほかのクラスの上書きを保ったまま、このクラスだけ入れ替えて送る
 */
function OverrideRowEditor({
  locale,
  substanceId,
  hazardClass,
  country,
  overrides,
  colSpan,
  onClose,
  onSaved,
}: {
  locale: Locale;
  substanceId: string;
  hazardClass: string;
  country: string;
  overrides: OverrideDto[];
  colSpan: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const all = sdsMessages(locale);
  const te = all.data.edit;
  const t = all.ghs;
  const ja = locale === "ja";
  const cls = GHS_CATALOG.find((c) => c.code === hazardClass);
  // 効く国: いま登録があればその範囲、無ければ「全ての国」
  const existingForClass = overrides.filter((o) => o.hazardClass === hazardClass);
  const initialScope = existingForClass.some((o) => o.country === country)
    ? country
    : existingForClass.some((o) => o.country === "")
      ? ""
      : "";
  const [scope, setScope] = useState<string>(initialScope);
  const current = overrides.find((o) => o.hazardClass === hazardClass && o.country === scope);
  const [status, setStatus] = useState<GhsStatus | "">(current?.status ?? "");
  const [category, setCategory] = useState(current?.category ?? "");
  const [organs, setOrgans] = useState(current?.targetOrgans ?? "");
  const [reason, setReason] = useState(overrides.find((o) => o.country === scope)?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 入力を始めたら、効く国を切り替えても下書きを消さない（切り替え前に打った区分が消える事故を防ぐ）
  const [dirty, setDirty] = useState(false);
  const changeScope = (s: string) => {
    setScope(s);
    setReason(overrides.find((o) => o.country === s)?.reason ?? "");
    if (dirty) return;
    const c = overrides.find((o) => o.hazardClass === hazardClass && o.country === s);
    setStatus(c?.status ?? "");
    setCategory(c?.category ?? "");
    setOrgans(c?.targetOrgans ?? "");
  };

  async function save(clear: boolean) {
    setError(null);
    // 同じ効く国のほかのクラスの上書きは保つ
    const others = overrides
      .filter((o) => o.country === scope && o.hazardClass !== hazardClass)
      .map((o) => ({
        hazardClass: o.hazardClass,
        status: o.status,
        category: o.category,
        targetOrgans: o.targetOrgans,
      }));
    const mine =
      clear || status === ""
        ? []
        : [
            {
              hazardClass,
              status: status as GhsStatus,
              category: status === "CLASSIFIED" ? category : "",
              targetOrgans: status === "CLASSIFIED" && organs.trim() ? organs.trim() : null,
            },
          ];
    if (mine.length > 0 && status === "CLASSIFIED" && !category)
      return setError(te.needCategory(cls ? (ja ? cls.nameJa : cls.nameEn) : hazardClass));
    const items = [...others, ...mine];
    if (items.length > 0 && !reason.trim()) return setError(te.needReason);
    setBusy(true);
    try {
      const res = await fetch("/api/modules/sds/ghs-data/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ substanceId, country: scope, reason: reason.trim(), items }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? `HTTP ${res.status}`);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="bg-muted/40 border-b">
      <td colSpan={colSpan} className="px-2 py-2">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">{te.override}</span>
            <select
              value={status}
              disabled={busy}
              onChange={(e) => {
                setDirty(true);
                setStatus(e.target.value as GhsStatus | "");
              }}
              className="border-input bg-background h-7 rounded-none border px-1 text-xs"
            >
              <option value="">{te.none}</option>
              {CHOICES.map((s) => (
                <option key={s} value={s}>
                  {t.status[s]}
                </option>
              ))}
            </select>
          </label>
          {status === "CLASSIFIED" && (
            <label className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">{te.category}</span>
              <select
                value={category}
                disabled={busy}
                onChange={(e) => {
                  setDirty(true);
                  setCategory(e.target.value);
                }}
                className="border-input bg-background h-7 rounded-none border px-1 text-xs"
              >
                <option value="">—</option>
                {(cls?.categories ?? []).map((k) => (
                  <option key={k.category} value={k.category}>
                    {ja
                      ? (k.nameJa ?? `区分${k.category}`)
                      : (k.nameEn ?? `Category ${k.category}`)}
                    {k.hCodes && k.hCodes.length > 0 ? ` (${k.hCodes.join(", ")})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {status === "CLASSIFIED" && (
            <label className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-xs">{te.organs}</span>
              <Input
                value={organs}
                disabled={busy}
                onChange={(e) => {
                  setDirty(true);
                  setOrgans(e.target.value);
                }}
                className="h-7 w-40 text-xs"
              />
            </label>
          )}
          <span className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs">{te.country}</span>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`ghs-ov-scope-${hazardClass}`}
                checked={scope === ""}
                onChange={() => changeScope("")}
              />
              {te.allCountries}
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name={`ghs-ov-scope-${hazardClass}`}
                checked={scope === country}
                onChange={() => changeScope(country)}
              />
              {te.onlyCountry(countryName(country, locale))}
            </label>
          </span>
          <label className="flex min-w-64 flex-1 flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">{te.reason}</span>
            <Input
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              className="h-7 text-xs"
              placeholder={te.reasonHint}
            />
          </label>
          <span className="flex gap-1">
            <Button type="button" size="xs" disabled={busy} onClick={() => void save(false)}>
              {te.save}
            </Button>
            {current && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={busy}
                onClick={() => void save(true)}
              >
                {t.section.clearOverride}
              </Button>
            )}
            <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onClose}>
              {te.cancel}
            </Button>
          </span>
        </div>
        {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
      </td>
    </tr>
  );
}
