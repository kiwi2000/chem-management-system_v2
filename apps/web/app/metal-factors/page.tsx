"use client";

import { emptyTableState, pickName, serializeTableState, type TableState } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ElementDto, ListResponse, MetalFactorDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

const DEFAULT_STATE: TableState = emptyTableState([
  { column: "casNumber", direction: "asc" },
  { column: "metalElement", direction: "asc" },
]);

const EMPTY_FORM = { id: "", casNumber: "", metalElement: "", ratioPct: "" };

/**
 * 金属換算係数。
 * 項目が3つだけなので、別画面にせず一覧の上のフォームで追加・編集する
 * （項目定義の画面と同じ形）。
 */
export default function MetalFactorsPage() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const editable = can("REGULATION_EDIT");

  /** 金属元素の選択肢。元素の表に登録されているものだけを選ばせる */
  const [elements, setElements] = useState<ElementDto[]>([]);

  const columns = useMemo<TableColumn<MetalFactorDto>[]>(
    () => [
      {
        key: "casNumber",
        header: m.metalFactors.casNumber,
        kind: "text",
        width: 140,
        className: "font-mono",
        render: (r) => r.casNumber,
      },
      {
        /*
          **元素の表から選ばせる。**手で打たせると `Pb` と `pb`、
          `鉛` と `Pb` が混ざって絞り込めない。複数選べる
        */
        key: "metalElement",
        header: m.metalFactors.metalElement,
        kind: "enum",
        options: elements.map((el) => ({
          value: el.symbol,
          label: `${el.symbol} — ${locale === "ja" ? el.nameJa : el.nameEn}`,
        })),
        width: 110,
        className: "font-mono",
        render: (r) => r.metalElement,
      },
      {
        key: "ratioPct",
        header: m.metalFactors.ratioPct,
        kind: "number",
        width: 150,
        className: "text-right font-mono",
        render: (r) => r.ratioPct,
      },
      {
        key: "matchedSubstances",
        header: m.metalFactors.matchedSubstances,
        kind: "text",
        width: 280,
        sortable: false,
        filterable: false,
        render: (r) =>
          r.matchedSubstances.length === 0 ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : (
            <span className="flex flex-wrap gap-2">
              {r.matchedSubstances.map((s) => (
                <Link
                  key={s.id}
                  href={`/substances/${s.id}`}
                  className="text-xs underline underline-offset-2"
                >
                  {s.code}: {pickName(locale, s.nameJa, s.nameEn)}
                </Link>
              ))}
            </span>
          ),
      },
      {
        key: "updatedAt",
        header: m.news.updatedAt,
        kind: "date",
        // 必ず入る列。「空白」で絞る意味が無い
        nullable: false,
        width: 120,
        className: "text-muted-foreground text-center text-xs",
        render: (r) => new Date(r.updatedAt).toLocaleDateString(locale),
      },
    ],
    [m, locale, elements],
  );

  const { state, setState, reset, ready } = useTableState(
    "chem.table.metalFactors",
    columns,
    DEFAULT_STATE,
  );

  const [data, setData] = useState<ListResponse<MetalFactorDto> | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  /**
   * 入力欄を開いているか。
   * **既定は閉じておく。**ふだんは一覧を見に来る画面で、
   * 常に開いていると表が下に押し下げられる
   */
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/metal-factors?${query}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setData({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setData((await res.json()) as ListResponse<MetalFactorDto>);
  }, [query, m]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  useEffect(() => {
    // 118個しかないので、1ページで全部引く
    void (async () => {
      const res = await fetch("/api/elements?size=200").catch(() => null);
      if (res?.ok) setElements(((await res.json()) as ListResponse<ElementDto>).items);
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWarnings([]);
    setSaving(true);
    try {
      const editing = form.id !== "";
      const res = await fetch(editing ? `/api/metal-factors/${form.id}` : "/api/metal-factors", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          casNumber: form.casNumber,
          metalElement: form.metalElement,
          ratioPct: form.ratioPct,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const body = (await res.json()) as { warnings?: string[] };
      setWarnings(body.warnings ?? []);
      setForm({ ...EMPTY_FORM });
      setFormOpen(false);
      void load();
    } finally {
      setSaving(false);
    }
  }

  /** 確認は共通テーブル側で出す。ここは消す処理だけ */
  async function onDeleteSelected(targets: MetalFactorDto[]) {
    setError(null);
    for (const f of targets) {
      const res = await fetch(`/api/metal-factors/${f.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
      if (form.id === f.id) setForm({ ...EMPTY_FORM });
    }
    void load();
  }

  return (
    <div className="w-full space-y-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{m.metalFactors.title}</h1>
      <p className="text-muted-foreground text-sm">{m.metalFactors.description}</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {editable && !formOpen && (
        <div>
          <Button
            type="button"
            onClick={() => {
              setForm({ ...EMPTY_FORM });
              setFormOpen(true);
            }}
          >
            {m.metalFactors.newTitle}
          </Button>
        </div>
      )}

      {editable && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {form.id ? m.metalFactors.editTitle : m.metalFactors.newTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-4">
              <div className="space-y-2">
                <Label htmlFor="cas">{m.metalFactors.casNumber}</Label>
                <Input
                  id="cas"
                  required
                  maxLength={20}
                  value={form.casNumber}
                  onChange={(e) => setForm({ ...form, casNumber: e.target.value })}
                  className="w-44 font-mono"
                  placeholder="7439-92-1"
                />
                {/* 注記は無いが、隣の欄と高さをそろえるため場所だけ空けておく */}
                <p className="min-h-4 text-xs" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="element">{m.metalFactors.metalElement}</Label>
                <select
                  id="element"
                  required
                  value={form.metalElement}
                  onChange={(e) => setForm({ ...form, metalElement: e.target.value })}
                  className="border-input bg-background h-8 w-40 rounded-none border px-2 font-mono text-sm"
                >
                  <option value="">{m.metalFactors.selectElement}</option>
                  {elements.map((el) => (
                    <option key={el.symbol} value={el.symbol}>
                      {el.symbol} — {locale === "ja" ? el.nameJa : el.nameEn}
                    </option>
                  ))}
                </select>
                <p className="min-h-4 text-xs" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ratio">{m.metalFactors.ratioPct}</Label>
                <Input
                  id="ratio"
                  required
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.ratioPct}
                  onChange={(e) => setForm({ ...form, ratioPct: e.target.value })}
                  className="w-32 text-right font-mono"
                  placeholder="92.83"
                />
                <p className="text-muted-foreground min-h-4 text-xs">{m.metalFactors.ratioHint}</p>
              </div>
              <div className="space-y-2">
                {/* 見出しの分だけ下げて、入力欄と同じ行に並べる */}
                <Label className="invisible" aria-hidden>
                  &nbsp;
                </Label>
                <div className="flex gap-2">
                  <Button type="submit" disabled={saving}>
                    {saving ? m.common.saving : m.common.save}
                  </Button>
                  {/* キャンセルで閉じる。書きかけの内容は捨てる */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setForm({ ...EMPTY_FORM });
                      setFormOpen(false);
                    }}
                  >
                    {m.common.cancel}
                  </Button>
                </div>
                <p className="min-h-4 text-xs" />
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <DataTable
        storageKey="chem.table.metalFactors"
        columns={columns}
        rows={data?.items ?? null}
        rowKey={(r) => r.id}
        total={data?.total ?? 0}
        state={state}
        defaultState={DEFAULT_STATE}
        onStateChange={setState}
        onReset={reset}
        emptyMessage={m.metalFactors.empty}
        selectable={editable}
        onDeleteSelected={onDeleteSelected}
        // この画面は詳細を別に持たないので、鉛筆で上のフォームに読み込む
        rowAction={
          editable
            ? {
                onClick: (f) => {
                  setForm({
                    id: f.id,
                    casNumber: f.casNumber,
                    metalElement: f.metalElement,
                    ratioPct: f.ratioPct,
                  });
                  setFormOpen(true);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                },
              }
            : undefined
        }
      />
    </div>
  );
}
