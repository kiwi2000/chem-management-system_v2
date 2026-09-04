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
import type { CasLinkRowDto, CountryDto, ListResponse, RegionDto } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { cn } from "@/lib/utils";

/** 既定は CAS 番号の順。サーバー側の既定と揃える（片方だけ変えると出てくる数がずれる） */
const DEFAULT_STATE: TableState = emptyTableState([{ column: "casNumber", direction: "asc" }]);

/** 1ページの件数。法文物質名の画面の対象CASと同じ */
const PAGE_SIZES = [15, 25, 50, 100, 200];

/** 区分・法律の画面から来たときの範囲。表の絞り込みとは別に、URL に載せて持ち回る */
export interface CasLinkScope {
  lawId: string | null;
  categoryId: string | null;
  /** 画面に出す名前（「化審法・第二種特定化学物質」など）。入口が付けてくる */
  label: string | null;
}

/**
 * 1つのバージョン × 1つのデータソースの対象CASを、法文物質名をまたいで1つの表にする。
 *
 * 外部データベースの画面の下に置く。上でデータソースの行を選ぶと中身が入れ替わる。
 * 取り込んだ内容を確かめるための表なので、**編集はしない**（法文物質名の画面に任せる）。
 * 絞り込み・並べ替え・ページングはすべてサーバー側（20万行規模）
 */
export function CasLinkTable({
  versionId,
  versionCode,
  sourceId,
  sourceCode,
  scope,
  onClearScope,
}: {
  versionId: string | null;
  versionCode: string | null;
  sourceId: string | null;
  sourceCode: string | null;
  scope: CasLinkScope;
  onClearScope: () => void;
}) {
  const { m, locale } = useI18n();
  const [data, setData] = useState<ListResponse<CasLinkRowDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionDto[]>([]);
  const [countries, setCountries] = useState<CountryDto[]>([]);

  // 地域・国の選択肢。件数が知れているので全部引く
  useEffect(() => {
    void (async () => {
      const [r, c] = await Promise.all([
        fetch("/api/regions?size=200").catch(() => null),
        fetch("/api/countries?size=200").catch(() => null),
      ]);
      if (r?.ok) setRegions(((await r.json()) as ListResponse<RegionDto>).items);
      if (c?.ok) setCountries(((await c.json()) as ListResponse<CountryDto>).items);
    })();
  }, []);

  const columns = useMemo<TableColumn<CasLinkRowDto>[]>(
    () => [
      {
        key: "regionId",
        header: m.casLinkTable.region,
        kind: "enum",
        width: 90,
        sortable: false,
        options: regions.map((r) => ({ value: r.id, label: pickName(locale, r.nameJa, r.nameEn) })),
        className: "text-xs",
        render: (r) => pickName(locale, r.regionNameJa, r.regionNameEn),
      },
      {
        key: "countryId",
        header: m.casLinkTable.country,
        kind: "enum",
        width: 90,
        sortable: false,
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
        sortable: false,
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
        sortable: false,
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
        // 押すと法文物質名の画面（対象CASの編集）へ
        render: (r) => (
          <Link
            href={`/statutory-substances/${r.statutorySubstanceId}`}
            className="hover:underline"
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
        width: 62,
        filterLabelHidden: true,
        options: [
          { value: "false", label: m.casLinks.applicable },
          { value: "true", label: m.casLinks.notApplicable },
        ],
        className: "text-center text-xs",
        render: (r) => (
          <span className={cn(r.excluded && "text-destructive font-medium")}>
            {r.excluded ? m.casLinks.notApplicable : m.casLinks.applicable}
          </span>
        ),
      },
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
      {
        key: "data",
        header: m.casLinks.data,
        kind: "text",
        width: 320,
        filterFullWidth: true,
        multiline: true,
        clampLines: 2,
        className: "text-xs",
        render: (r) => {
          const text = (locale === "ja" ? (r.dataJa ?? r.data) : r.data) ?? "";
          return <span title={text}>{text}</span>;
        },
      },
      {
        key: "note",
        header: m.casLinks.note,
        kind: "text",
        width: 200,
        className: "text-muted-foreground text-xs",
        render: (r) => r.note ?? "",
      },
      {
        key: "updatedAt",
        header: m.casLinkTable.updatedAt,
        kind: "date",
        width: 110,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ],
    [m, locale, regions, countries],
  );

  // 同じ画面の上の表と URL がぶつからないよう、接頭辞を付ける
  const { state, setState, reset, ready } = useTableState(
    "chem.table.casLinkTable",
    columns,
    DEFAULT_STATE,
    "cl",
  );
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  /*
    バージョンやデータソースを替えたら1ページ目から。
    ページ番号は表ごとに覚えているので、前の組で21ページ目を見ていると次の組でも空のページから始まる
  */
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const key = `${versionId ?? ""}/${sourceId ?? ""}/${scope.lawId ?? ""}/${scope.categoryId ?? ""}`;
    if (shownFor.current !== null && shownFor.current !== key && state.page !== 1) {
      setState((prev) => ({ ...prev, page: 1 }));
    }
    shownFor.current = key;
    // state.page は「いま1ページ目でなければ戻す」の判定にしか使わないので依存に入れない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, versionId, sourceId, scope.lawId, scope.categoryId]);

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
    if (scope.lawId) params.set("lawId", scope.lawId);
    if (scope.categoryId) params.set("categoryId", scope.categoryId);
    const key = params.toString();
    wantKey.current = key;
    void (async () => {
      setError(null);
      const res = await fetch(`/api/cas-links?${key}`).catch(() => null);
      if (wantKey.current !== key) return;
      if (!res) {
        setError(m.errors.loadFailed(0));
        return;
      }
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        setError(m.errors.loadFailed(res.status));
        return;
      }
      setData((await res.json()) as ListResponse<CasLinkRowDto>);
    })();
  }, [ready, versionId, sourceId, scope.lawId, scope.categoryId, query, m]);

  const scoped = scope.lawId !== null || scope.categoryId !== null;

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
          </>
        }
        storageKey="chem.table.casLinkTable"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        pageSizeOptions={PAGE_SIZES}
        emptyMessage={!versionId || !sourceId ? m.casLinkTable.pickSource : m.casLinks.empty}
        headerActions={
          scoped ? (
            // 区分・法律の画面から来た範囲。押すと外れて、全体の表になる
            <Button size="sm" variant="secondary" onClick={onClearScope} className="gap-1">
              <span className="text-muted-foreground">
                {scope.categoryId ? m.casLinkTable.scopeCategory : m.casLinkTable.scopeLaw}:
              </span>
              {scope.label ?? ""}
              <X className="size-3.5" aria-label={m.casLinkTable.clearScope} />
            </Button>
          ) : undefined
        }
      />
    </section>
  );
}
