"use client";

import {
  emptyTableState,
  pickName,
  serializeTableState,
  type Locale,
  type TableState,
} from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ListResponse } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";
import { GHS_CATALOG } from "../ghs/catalog-data";
import { DEFAULT_COUNTRY, SDS_COUNTRIES } from "../ghs/countries";
import type { AdoptedCellDto, GhsDataRowDto } from "../ghs/data-dto";
import { sdsMessages } from "../messages";
import { GhsAdoptionRules } from "./ghs-adoption-rules";
import { GhsOverrideEditor } from "./ghs-override-editor";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "code", direction: "asc" }]);
const STORAGE_KEY = "chem.table.sdsGhsData";
/** 選んだ国を端末に覚える */
const COUNTRY_KEY = "chem.sds.ghsData.country";

/** 区分の短い表示（カタログの日本語名「〜 区分2」→「区分2」。英語は区分そのもの。区分の記載なしは出典の言葉） */
export function categoryText(
  hazardClass: string,
  category: string,
  ja: boolean,
  unspecified: string,
): string {
  if (category === "UNSPEC") return unspecified;
  const k = GHS_CATALOG.find((c) => c.code === hazardClass)?.categories.find(
    (x) => x.category === category,
  );
  if (!ja) return category;
  const name = k?.nameJa ?? `区分${category}`;
  const m = name.match(/区分[0-9A-Z.]+$/);
  return m ? m[0] : name;
}

/**
 * GHS データ: 物質 × 採用した分類の一覧（共通の表）。列はクラスごと。
 * 上で SDS の対象の国を選ぶと、その国の採用順で採った分類に変わる。行末の鉛筆で自社判定を登録
 */
export function GhsDataTable({
  locale,
  canEdit,
  isAdmin,
}: {
  locale: Locale;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const { m } = useI18n();
  const t = sdsMessages(locale);
  const ja = locale === "ja";
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [data, setData] = useState<ListResponse<GhsDataRowDto> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<GhsDataRowDto | null>(null);

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

  const cell = useCallback(
    (hazardClass: string, c: AdoptedCellDto | undefined) => {
      if (!c || c.status === "NOT_EVALUATED") return null;
      const from = c.from ? (t.data.sourceShort[c.from] ?? c.from) : "";
      const tag = <span className="text-muted-foreground ml-1 text-[10px]">{from}</span>;
      // 該当以外は出典の言葉だけ（列が狭いので、出典の印は自社判定のときだけ添える）
      if (c.status !== "CLASSIFIED") {
        return (
          <span className="text-muted-foreground text-xs">
            {t.ghs.status[c.status]}
            {c.from === "OVERRIDE" && tag}
          </span>
        );
      }
      return (
        <span className={c.from === "OVERRIDE" ? "font-medium text-primary" : "font-medium"}>
          {c.items.map((it, i) => (
            <span key={it.category}>
              {i > 0 && "、"}
              {categoryText(hazardClass, it.category, ja, t.ghs.section.classifiedUnspecified)}
              {it.targetOrgans && (
                <span className="text-muted-foreground ml-1 text-[10px] font-normal">
                  {it.targetOrgans}
                </span>
              )}
            </span>
          ))}
          {tag}
        </span>
      );
    },
    [t, ja],
  );

  const columns = useMemo<TableColumn<GhsDataRowDto>[]>(
    () => [
      {
        key: "code",
        header: t.data.columns.code,
        kind: "text",
        width: 130,
        render: (r) => (
          <Link
            href={`/substances/${r.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {r.code}
          </Link>
        ),
      },
      {
        key: ja ? "nameJa" : "nameEn",
        header: t.data.columns.name,
        kind: "text",
        width: 200,
        render: (r) => pickName(locale, r.nameJa, r.nameEn),
      },
      {
        key: "casNumber",
        header: t.data.columns.cas,
        kind: "list",
        width: 110,
        render: (r) => r.casNumber ?? "",
      },
      ...GHS_CATALOG.map((cls): TableColumn<GhsDataRowDto> => ({
        key: `cls:${cls.code}`,
        // 39 列あるので見出しは短い名前。詰めすぎず、狭い画面では横に流す
        header: ja ? (cls.shortJa ?? cls.nameJa) : (cls.shortEn ?? cls.abbrevEn),
        kind: "text",
        width: 104,
        minWidth: 104,
        sortable: false,
        filterable: false,
        render: (r) => cell(cls.code, r.cells[cls.code]),
      })),
    ],
    [t, ja, locale, cell],
  );

  const { state, setState, ready } = useTableState(STORAGE_KEY, columns, DEFAULT_STATE);
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);
  const load = useCallback(async () => {
    const res = await fetch(
      `/api/modules/sds/ghs-data?${query}&country=${encodeURIComponent(country)}`,
    );
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setError(null);
    setData((await res.json()) as ListResponse<GhsDataRowDto>);
  }, [query, country, m]);
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="ghs-country">{t.data.country}</Label>
        <select
          id="ghs-country"
          value={country}
          onChange={(e) => chooseCountry(e.target.value)}
          className="border-input bg-background h-8 rounded-none border px-2 text-sm"
        >
          {SDS_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name[locale]}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        storageKey={STORAGE_KEY}
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        emptyMessage={t.data.empty}
        rowAction={
          canEdit ? { onClick: (r) => setEditing(r), disabled: () => editing !== null } : undefined
        }
      />
      {editing && (
        <GhsOverrideEditor
          locale={locale}
          row={editing}
          country={country}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      <GhsAdoptionRules
        locale={locale}
        country={country}
        isAdmin={isAdmin}
        onSaved={() => void load()}
      />
    </div>
  );
}
