"use client";

import {
  emptyTableState,
  pickName,
  pickStatutoryName,
  serializeTableState,
  type TableState,
} from "@chem/shared";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type {
  CasLinkDiffRowDto,
  CasLinkDiffRunDto,
  CasLinkRowDto,
  CountryDto,
  LinkSetVersionDto,
  ListResponse,
  RegionDto,
} from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { cn } from "@/lib/utils";

/** 既定は CAS 番号の順。サーバー側の既定と揃える（片方だけ変えると出てくる数がずれる） */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "casNumber", direction: "asc" }]);
/** 差分モードは 種類 → CAS の順。増えた・消えた・変わった がまとまる */
const DIFF_DEFAULT_STATE: TableState = emptyTableState([
  { column: "kind", direction: "asc" },
  { column: "casNumber", direction: "asc" },
]);

const SELECT_CLASS = "border-input bg-background h-8 rounded-none border px-2 text-sm";

/** 差分の種類の印の色。増えた＝緑、消えた＝赤、変わった＝黄 */
const KIND_CLASS: Record<CasLinkDiffRowDto["kind"], string> = {
  added: "bg-emerald-600 text-white",
  removed: "bg-red-600 text-white",
  changed: "bg-amber-500 text-white",
  unchanged: "bg-slate-500 text-white",
};

/** 区分・法律の画面から来たときの範囲。表の絞り込みとは別に、URL に載せて持ち回る */
export interface CasLinkScope {
  lawId: string | null;
  categoryId: string | null;
  /** 画面に出す名前（「化審法・第二種特定化学物質」など）。入口が付けてくる */
  label: string | null;
}

/**
 * 表の1行。通常モードは対象CASの行そのまま。
 * 差分モードは同じ項目に、種類と前後の中身が付く
 */
type Row = CasLinkRowDto & Partial<Pick<CasLinkDiffRowDto, "kind" | "current" | "previous">>;

interface DiffResponse extends ListResponse<CasLinkDiffRowDto> {
  run: CasLinkDiffRunDto;
}

/**
 * 1つのバージョン × 1つのデータソースの対象CASを、法文物質名をまたいで1つの表にする。
 *
 * 外部データベースの画面の下に置く。上でデータソースの行を選ぶと中身が入れ替わる。
 * 取り込んだ内容を確かめるための表なので、**編集はしない**（法文物質名の画面に任せる）。
 * 絞り込み・並べ替え・ページングはすべてサーバー側（20万行規模）。
 *
 * **「差分」で別のバージョンと比べられる。**同じデータソースの別の版と突き合わせ、
 * 増えた・消えた・変わった だけを出す。消えた行は今の版に無いので薄く出す。
 * 該非・出典データは「前 → 後」で並べる
 */
export function CasLinkTable({
  versionId,
  versionCode,
  sourceId,
  sourceCode,
  scope,
  onClearScope,
  against,
  onAgainstChange,
}: {
  versionId: string | null;
  versionCode: string | null;
  sourceId: string | null;
  sourceCode: string | null;
  scope: CasLinkScope;
  onClearScope: () => void;
  /** 比べる相手のバージョン。null なら通常の表 */
  against: string | null;
  onAgainstChange: (id: string | null) => void;
}) {
  const { m, locale } = useI18n();
  const [data, setData] = useState<{
    items: Row[];
    total: number;
    run: CasLinkDiffRunDto | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionDto[]>([]);
  const [countries, setCountries] = useState<CountryDto[]>([]);
  const [versions, setVersions] = useState<LinkSetVersionDto[]>([]);

  // 自分自身とは比べられない。URL に残っていても通常の表として扱う
  const diffAgainst = against !== null && against !== versionId ? against : null;
  const diffMode = diffAgainst !== null;

  // 地域・国・バージョンの選択肢。件数が知れているので全部引く
  useEffect(() => {
    void (async () => {
      const [r, c, v] = await Promise.all([
        fetch("/api/regions?size=200").catch(() => null),
        fetch("/api/countries?size=200").catch(() => null),
        fetch("/api/link-versions?size=50").catch(() => null),
      ]);
      if (r?.ok) setRegions(((await r.json()) as ListResponse<RegionDto>).items);
      if (c?.ok) setCountries(((await c.json()) as ListResponse<CountryDto>).items);
      if (v?.ok) setVersions(((await v.json()) as ListResponse<LinkSetVersionDto>).items);
    })();
  }, []);

  const statusLabel = (excluded: boolean) =>
    excluded ? m.casLinks.notApplicable : m.casLinks.applicable;
  const dataText = (side: { data: string | null; dataJa: string | null } | null | undefined) =>
    (side ? (locale === "ja" ? (side.dataJa ?? side.data) : side.data) : null) ?? "";

  const columns = useMemo<TableColumn<Row>[]>(() => {
    const kindColumn: TableColumn<Row>[] = diffMode
      ? [
          {
            key: "kind",
            header: m.casLinkTable.diffKind,
            kind: "enum",
            width: 76,
            // 絞り込みは押すボタンにして、印と同じ色を付ける（プルダウンでは気づかれなかった）
            filterAsButtons: true,
            // 値は DB の種類そのもの（絞り込みはサーバーで見る）
            options: [
              { value: "ADDED", label: m.casLinkTable.diffAdded, color: "#059669" },
              { value: "REMOVED", label: m.casLinkTable.diffRemoved, color: "#dc2626" },
              { value: "CHANGED", label: m.casLinkTable.diffChanged, color: "#f59e0b" },
              // 変更なしは押したときだけ出る（何も押していなければ差分だけ）
              { value: "UNCHANGED", label: m.casLinkTable.diffUnchanged, color: "#64748b" },
            ],
            className: "text-center",
            render: (r) =>
              r.kind ? (
                <span
                  className={cn(
                    "inline-block rounded px-1.5 py-0.5 text-[11px] leading-tight font-medium",
                    KIND_CLASS[r.kind],
                  )}
                >
                  {r.kind === "added"
                    ? m.casLinkTable.diffAdded
                    : r.kind === "removed"
                      ? m.casLinkTable.diffRemoved
                      : r.kind === "changed"
                        ? m.casLinkTable.diffChanged
                        : m.casLinkTable.diffUnchanged}
                </span>
              ) : null,
          },
        ]
      : [];
    return [
      ...kindColumn,
      {
        key: "regionId",
        header: m.casLinkTable.region,
        kind: "enum",
        width: 90,
        options: regions.map((r) => ({ value: r.id, label: pickName(locale, r.nameJa, r.nameEn) })),
        className: "text-xs",
        render: (r) => pickName(locale, r.regionNameJa, r.regionNameEn),
      },
      {
        key: "countryId",
        header: m.casLinkTable.country,
        kind: "enum",
        width: 90,
        options: countries.map((c) => ({
          value: c.id,
          label: pickName(locale, c.nameJa, c.nameEn),
        })),
        className: "text-xs",
        render: (r) => pickName(locale, r.countryNameJa, r.countryNameEn),
      },
      {
        key: "lawName",
        header: m.casLinkTable.law,
        kind: "text",
        width: 160,
        className: "text-xs",
        render: (r) => (
          <Link href={`/laws`} className="hover:underline" title={r.lawCode}>
            {pickStatutoryName(locale, r.lawNameOriginal, r.lawNameJa, r.lawNameEn)}
          </Link>
        ),
      },
      {
        key: "categoryName",
        header: m.casLinkTable.category,
        kind: "text",
        width: 180,
        className: "text-xs",
        // 押すと区分の画面（法文物質名の一覧）へ。ここで見つけたものを直しに行ける
        render: (r) => (
          <Link
            href={`/categories/${r.categoryId}`}
            className="hover:underline"
            title={r.categoryCode}
          >
            {pickStatutoryName(locale, r.categoryNameOriginal, r.categoryNameJa, r.categoryNameEn)}
          </Link>
        ),
      },
      {
        key: "className",
        header: m.casLinkTable.className,
        kind: "text",
        width: 140,
        className: "text-muted-foreground text-xs",
        render: (r) =>
          r.classNameOriginal === null
            ? ""
            : pickStatutoryName(locale, r.classNameOriginal, r.classNameJa, r.classNameEn),
      },
      {
        key: "officialNumber",
        header: m.casLinkTable.officialNumber,
        kind: "text",
        width: 130,
        className: "text-xs",
        render: (r) => r.officialNumber ?? "",
      },
      {
        key: "statutoryName",
        header: m.casLinkTable.statutoryName,
        kind: "text",
        width: 280,
        className: "text-xs",
        // 押すと法文物質名の画面（対象CASの編集）へ。消えたものは取り消し線
        render: (r) => (
          <Link
            href={`/statutory-substances/${r.statutorySubstanceId}`}
            className={cn("hover:underline", r.kind === "removed" && "line-through")}
          >
            {pickStatutoryName(
              locale,
              r.statutoryNameOriginal,
              r.statutoryNameJa,
              r.statutoryNameEn,
            )}
          </Link>
        ),
      },
      {
        key: "casNumber",
        header: m.casLinks.casNumber,
        kind: "text",
        width: 120,
        className: "font-mono text-xs",
        render: (r) => r.casNumber,
      },
      {
        // CAS番号だけでは何なのか分からないので、名前を隣に置く（物質マスタの代表物質）
        key: "casName",
        header: m.casLinks.casName,
        kind: "text",
        width: 240,
        sortable: false,
        filterPlaceholder: m.casLinks.casName,
        className: "text-xs",
        render: (r) => {
          const label =
            (locale === "ja"
              ? (r.substanceNameJa ?? r.substanceNameEn)
              : (r.substanceNameEn ?? r.substanceNameJa)) ?? "";
          return r.substanceId ? (
            <Link href={`/substances/${r.substanceId}`} className="hover:underline">
              {label}
            </Link>
          ) : (
            label
          );
        },
      },
      {
        key: "excluded",
        header: m.casLinks.status,
        kind: "enum",
        width: diffMode ? 110 : 62,
        filterLabelHidden: true,
        // 差分モードでは前後2つあるので、絞り込み・並べ替えは出さない
        filterable: !diffMode,
        options: [
          { value: "false", label: m.casLinks.applicable },
          { value: "true", label: m.casLinks.notApplicable },
        ],
        className: "text-center text-xs",
        render: (r) => {
          // 変わったもので該非が違うときだけ「前 → 後」
          if (
            r.kind === "changed" &&
            r.previous &&
            r.current &&
            r.previous.excluded !== r.current.excluded
          ) {
            return (
              <span className="whitespace-nowrap">
                {statusLabel(r.previous.excluded)} →{" "}
                <span className={cn(r.current.excluded && "text-destructive font-medium")}>
                  {statusLabel(r.current.excluded)}
                </span>
              </span>
            );
          }
          return (
            <span className={cn(r.excluded && "text-destructive font-medium")}>
              {statusLabel(r.excluded)}
            </span>
          );
        },
      },
      ...(diffMode
        ? []
        : ([
            {
              /*
                優先度で勝っている行の印。**このページの行についてだけ**計算しているので、
                絞り込みや並べ替えには使えない（全件で計算すると重い）
              */
              key: "used",
              header: m.casLinkTable.used,
              kind: "text",
              width: 48,
              sortable: false,
              filterable: false,
              className: "text-center",
              render: (r) =>
                r.used ? (
                  <Check className="text-primary mx-auto size-4" aria-label={m.casLinkTable.used} />
                ) : null,
            },
          ] satisfies TableColumn<Row>[])),
      {
        key: "data",
        header: m.casLinks.data,
        kind: "text",
        width: 320,
        filterFullWidth: true,
        filterable: !diffMode,
        multiline: true,
        clampLines: diffMode ? 4 : 2,
        className: "text-xs",
        render: (r) => {
          /*
            変わったもので文章が違うときは「前」「後」を2段で。
            **比べるのも出すのも原文**（差分は原文で決めている）。日本語訳は片方の版にしか無いことがあり、
            訳で出すと同じ文章が別物に見える
          */
          if (r.kind === "changed" && r.previous && r.current) {
            const before = (r.previous.data ?? "").trim();
            const after = (r.current.data ?? "").trim();
            if (before !== after) {
              return (
                <span
                  title={`${m.casLinkTable.diffBefore}: ${before}\n${m.casLinkTable.diffAfter}: ${after}`}
                >
                  <span className="text-muted-foreground block line-through">{before || "—"}</span>
                  <span className="block">{after || "—"}</span>
                </span>
              );
            }
          }
          const text = dataText(r);
          return <span title={text}>{text}</span>;
        },
      },
      {
        key: "note",
        header: m.casLinks.note,
        kind: "text",
        width: 200,
        filterable: !diffMode,
        className: "text-muted-foreground text-xs",
        render: (r) => r.note ?? "",
      },
      {
        key: "updatedAt",
        header: m.casLinkTable.updatedAt,
        kind: "date",
        width: 110,
        filterable: !diffMode,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ];
    // statusLabel / dataText は m と locale だけで決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, locale, regions, countries, diffMode]);

  const fallback = diffMode ? DIFF_DEFAULT_STATE : DEFAULT_STATE;
  // 同じ画面の上の表と URL がぶつからないよう、接頭辞を付ける
  const { state, setState, ready } = useTableState(
    "chem.table.casLinkTable",
    columns,
    fallback,
    "cl",
  );
  const query = useMemo(() => serializeTableState(state, fallback).toString(), [state, fallback]);

  /*
    バージョン・データソース・比べる相手を替えたら1ページ目から。
    ページ番号は表ごとに覚えているので、前の組で21ページ目を見ていると次の組でも空のページから始まる
  */
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const key = `${versionId ?? ""}/${sourceId ?? ""}/${diffAgainst ?? ""}/${scope.lawId ?? ""}/${scope.categoryId ?? ""}`;
    if (shownFor.current !== null && shownFor.current !== key && state.page !== 1) {
      setState((prev) => ({ ...prev, page: 1 }));
    }
    shownFor.current = key;
    // state.page は「いま1ページ目でなければ戻す」の判定にしか使わないので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, versionId, sourceId, diffAgainst, scope.lawId, scope.categoryId]);

  /** いま欲しい問い合わせ。届いたものはこれと突き合わせ、後から投げたものが勝つ */
  const wantKey = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (!versionId || !sourceId) {
      setData(null);
      return;
    }
    const params = new URLSearchParams(query);
    params.set("versionId", versionId);
    params.set("sourceId", sourceId);
    if (diffAgainst) params.set("againstId", diffAgainst);
    if (scope.lawId) params.set("lawId", scope.lawId);
    if (scope.categoryId) params.set("categoryId", scope.categoryId);
    const url = `${diffAgainst ? "/api/cas-links/diff" : "/api/cas-links"}?${params.toString()}`;
    wantKey.current = url;
    void (async () => {
      setError(null);
      const res = await fetch(url).catch(() => null);
      if (wantKey.current !== url) return;
      if (!res) {
        setError(m.errors.loadFailed(0));
        return;
      }
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        setError(m.errors.loadFailed(res.status));
        return;
      }
      if (diffAgainst) {
        const body = (await res.json()) as DiffResponse;
        setData({ items: body.items, total: body.total, run: body.run });
      } else {
        const body = (await res.json()) as ListResponse<CasLinkRowDto>;
        setData({ items: body.items, total: body.total, run: null });
      }
    })();
  }, [ready, versionId, sourceId, diffAgainst, scope.lawId, scope.categoryId, query, m]);

  const scoped = scope.lawId !== null || scope.categoryId !== null;
  const run = data?.run ?? null;

  return (
    <section className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <DataTable
        title={
          <>
            {m.casLinkTable.title}
            {/* どのバージョン・データソースの中身かは間違えやすいので、はっきり出す */}
            {versionCode && (
              <span className="bg-primary text-primary-foreground ml-2 rounded px-2 py-0.5 align-middle font-mono text-sm">
                {versionCode}
              </span>
            )}
            {sourceCode && (
              <span className="bg-primary text-primary-foreground ml-1 rounded px-2 py-0.5 align-middle font-mono text-sm">
                {sourceCode}
              </span>
            )}
            {/* 差分モードでは比べた相手も並べる */}
            {run && (
              <span className="bg-secondary text-secondary-foreground ml-1 rounded px-2 py-0.5 align-middle font-mono text-sm">
                ↔ {run.againstCode}
              </span>
            )}
          </>
        }
        storageKey="chem.table.casLinkTable"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={fallback}
        onStateChange={setState}
        // 消えた行は今の版に無いので薄く
        rowClassName={(r) => (r.kind === "removed" ? "opacity-60" : undefined)}
        emptyMessage={
          !versionId || !sourceId
            ? m.casLinkTable.pickSource
            : diffMode
              ? m.casLinkTable.diffEmpty
              : m.casLinks.empty
        }
        headerActions={
          <div className="flex flex-wrap items-center gap-2">
            {scoped && (
              // 区分・法律の画面から来た範囲。押すと外れて、全体の表になる
              <Button size="sm" variant="secondary" onClick={onClearScope} className="gap-1">
                <span className="text-muted-foreground">
                  {scope.categoryId ? m.casLinkTable.scopeCategory : m.casLinkTable.scopeLaw}:
                </span>
                {scope.label ?? ""}
                <X className="size-3.5" aria-label={m.casLinkTable.clearScope} />
              </Button>
            )}
            {/*
              比べる相手。同じデータソースの別の版だけが候補。
              選ぶと差分モードになり、「差分なし」に戻すと通常の表
            */}
            <select
              className={SELECT_CLASS}
              value={diffAgainst ?? ""}
              onChange={(e) => onAgainstChange(e.target.value || null)}
              aria-label={m.casLinkTable.diff}
              title={m.casLinkTable.diffHint}
              disabled={!versionId || !sourceId}
            >
              <option value="">{m.casLinkTable.diffOff}</option>
              {versions
                .filter((v) => v.id !== versionId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {m.casLinkTable.diffAgainst(v.code)}
                  </option>
                ))}
            </select>
            {run && (
              <span className="text-xs tabular-nums" title={m.casLinkTable.diffHint}>
                <span className="text-emerald-700 dark:text-emerald-400">
                  +{run.added.toLocaleString(locale)}
                </span>{" "}
                <span className="text-red-700 dark:text-red-400">
                  −{run.removed.toLocaleString(locale)}
                </span>{" "}
                <span className="text-amber-700 dark:text-amber-400">
                  ±{run.changed.toLocaleString(locale)}
                </span>
              </span>
            )}
          </div>
        }
      />
    </section>
  );
}
