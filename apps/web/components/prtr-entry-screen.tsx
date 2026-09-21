"use client";

import {
  defaultPrtrFiscalYear,
  emptyTableState,
  pickName,
  pickStatutoryName,
  PRTR_METHODS,
  type PrtrMethod,
  type TableState,
} from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { FieldError } from "@/components/field-error";
import { PrtrImportDialog } from "@/components/prtr-import-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  PrtrEntryDto,
  PrtrMeasuredDto,
  PrtrQuantityDto,
  PrtrScopeDto,
} from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const Q_KEY = "chem.table.prtrQuantities";
const M_KEY = "chem.table.prtrMeasured";
const Q_STATE: TableState = emptyTableState([{ column: "productCode", direction: "asc" }]);
const M_STATE: TableState = emptyTableState([{ column: "officialNumber", direction: "asc" }]);

const SELECT = "border-input bg-background h-8 rounded-none border px-2 text-sm";
/** 取り込めるファイル。OS の選択画面ではこれだけ選べる */
const IMPORT_ACCEPT = ".csv,.tsv,.txt,.xlsx";

/**
 * 取り込み用のテンプレート（Excel）を落とす。全部の形（数量・実測値）がシートに分かれて 1 つに入っている。
 * 各シートの 1 行目の見出しが、そのまま列の割り当てに当たる
 */
function TemplateButton() {
  const { m } = useI18n();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        window.location.href = "/api/prtr/template";
      }}
    >
      {m.prtr.import.template}
    </Button>
  );
}

/** 「ファイル」ボタン。押すと OS のファイル選択が開き、選ぶと取り込みの窓が開く */
function FilePickButton({ label, onPick }: { label: string; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // 同じファイルをもう一度選べるように、値は毎回消す
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
      <Button size="sm" variant="outline" onClick={() => ref.current?.click()}>
        {label}
      </Button>
    </>
  );
}

/**
 * PRTR 届出データの入力（S22）。
 *
 * 所属と年度を選び、方法（実測値・物質収支・排出係数）を決めて保存すると、
 * 製品ごとの数量（と、実測値のときは物質ごとの実測値）を入れられる。
 * 入力は画面の 1 件登録と、ファイルの取り込み（列の割り当て付き）の両方
 */
export function PrtrEntryScreen() {
  const { m, locale } = useI18n();
  const { can } = useMe();
  const t = m.prtr;
  const [scope, setScope] = useState<PrtrScopeDto | null>(null);
  const [orgId, setOrgId] = useState("");
  const [fiscalYear, setFiscalYear] = useState(defaultPrtrFiscalYear());
  const [data, setData] = useState<PrtrEntryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 頭（方法・係数・備考）
  const [method, setMethod] = useState<PrtrMethod>("BALANCE");
  const [factorPct, setFactorPct] = useState("");
  const [note, setNote] = useState("");
  const [headErrors, setHeadErrors] = useState<FieldErrors>({});
  const [savingHead, setSavingHead] = useState(false);
  /** 方法を変えるときの確認（入れてある数量の意味が変わる） */
  const [askMethod, setAskMethod] = useState(false);

  const years = useMemo(() => {
    const base = defaultPrtrFiscalYear();
    return [base + 1, base, base - 1, base - 2, base - 3, base - 4];
  }, []);

  // 所属
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/prtr/scope").catch(() => null);
      if (!res?.ok) {
        if (res) redirectIfUnauthorized(res);
        return;
      }
      const body = (await res.json()) as PrtrScopeDto;
      setScope(body);
      setOrgId((cur) => cur || body.organisations[0]?.id || "");
    })();
  }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    const params = new URLSearchParams({ organisationId: orgId, fiscalYear: String(fiscalYear) });
    const res = await fetch(`/api/prtr/entries?${params.toString()}`).catch(() => null);
    if (!res?.ok) {
      if (res) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
      }
      return;
    }
    const body = (await res.json()) as PrtrEntryDto;
    setData(body);
    setMethod(body.entry?.method ?? "BALANCE");
    setFactorPct(body.entry?.factorPct ?? "");
    setNote(body.entry?.note ?? "");
    setHeadErrors({});
  }, [orgId, fiscalYear, m]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveHead() {
    setError(null);
    setNotice(null);
    setHeadErrors({});
    setSavingHead(true);
    try {
      const res = await fetch("/api/prtr/entries", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: orgId,
          fiscalYear,
          method,
          factorPct: factorPct || null,
          note: note || null,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        setHeadErrors(toFieldErrors(body?.error.details));
        return;
      }
      setData((await res.json()) as PrtrEntryDto);
      setNotice(t.headerSaved);
      setAskMethod(false);
    } finally {
      setSavingHead(false);
    }
  }

  const entry = data?.entry ?? null;
  const methodChanged = entry !== null && entry.method !== method;
  const hasRows = (data?.quantities.length ?? 0) + (data?.measured.length ?? 0) > 0;

  if (scope && scope.organisations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>{t.noOrganisation}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {/* 所属・年度・方法は入り口なので畳まない。下の表は最初から開いておく */}
      <Card collapsible={false}>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{t.title}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">{t.lead}</p>
          </div>
          <TemplateButton />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="prtr-org">{t.organisation}</Label>
              <select
                id="prtr-org"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className={`${SELECT} max-w-xs`}
              >
                {(scope?.organisations ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} {pickName(locale, o.nameJa, o.nameEn)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="prtr-year">{t.fiscalYear}</Label>
              <select
                id="prtr-year"
                value={fiscalYear}
                onChange={(e) => setFiscalYear(Number(e.target.value))}
                className={SELECT}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {t.fiscalYearLabel(y)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="prtr-method">{t.method}</Label>
              <select
                id="prtr-method"
                value={method}
                onChange={(e) => setMethod(e.target.value as PrtrMethod)}
                className={SELECT}
              >
                {PRTR_METHODS.map((k) => (
                  <option key={k} value={k}>
                    {t.methods[k]}
                  </option>
                ))}
              </select>
            </div>
            {method === "FACTOR" && (
              <div className="space-y-1">
                <Label htmlFor="prtr-factor">{t.factorPct}</Label>
                <Input
                  id="prtr-factor"
                  inputMode="decimal"
                  value={factorPct}
                  onChange={(e) => setFactorPct(e.target.value)}
                  aria-invalid={Boolean(firstError(headErrors, "factorPct"))}
                  className="h-8 w-32 font-mono"
                />
                <FieldError message={firstError(headErrors, "factorPct")} />
              </div>
            )}
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor="prtr-note">{t.note}</Label>
              <Input
                id="prtr-note"
                value={note}
                maxLength={2000}
                onChange={(e) => setNote(e.target.value)}
                className="h-8"
              />
            </div>
            <Button
              size="sm"
              disabled={savingHead || !orgId}
              onClick={() => {
                // 入れてあるものの意味が変わるので、方法の変更だけは一度確かめる
                if (methodChanged && hasRows && !askMethod) setAskMethod(true);
                else void saveHead();
              }}
            >
              {savingHead ? m.common.saving : m.common.save}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {t.methodHints[method]}
            {method === "FACTOR" && ` ${t.factorHint}`}
          </p>
          {askMethod && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{t.changeMethodAsk}</span>
                <Button size="sm" onClick={() => void saveHead()}>
                  {m.common.ok}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAskMethod(false)}>
                  {m.common.cancel}
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {entry && data && (
        <QuantitySection
          entryId={entry.id}
          method={entry.method}
          rows={data.quantities}
          canSeeProducts={can("PRODUCT_VIEW")}
          onChanged={load}
        />
      )}
      {entry && data && entry.method === "MEASURED" && (
        <MeasuredSection entryId={entry.id} rows={data.measured} onChanged={load} />
      )}
    </div>
  );
}

/** 製品ごとの数量 */
function QuantitySection({
  entryId,
  method,
  rows,
  canSeeProducts,
  onChanged,
}: {
  entryId: string;
  method: PrtrMethod;
  rows: PrtrQuantityDto[];
  canSeeProducts: boolean;
  onChanged: () => Promise<void>;
}) {
  const { m, locale } = useI18n();
  const t = m.prtr.quantities;
  const [form, setForm] = useState({ id: "", productCode: "", purchasedKg: "", shippedKg: "" });
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<PrtrQuantityDto>[]>(
    () => [
      {
        key: "productCode",
        header: t.productCode,
        kind: "text",
        width: 140,
        className: "font-mono text-xs",
        render: (q) =>
          canSeeProducts ? (
            <Link href={`/products/${q.productId}`} className="text-primary underline">
              {q.productCode}
            </Link>
          ) : (
            q.productCode
          ),
      },
      {
        key: "productName",
        header: t.productName,
        kind: "text",
        width: 280,
        render: (q) => pickName(locale, q.productNameJa, q.productNameEn),
      },
      {
        key: "purchasedKg",
        header: t.purchasedKg,
        kind: "number",
        width: 120,
        className: "text-right font-mono tabular-nums",
        render: (q) => q.purchasedKg,
      },
      {
        key: "shippedKg",
        header: t.shippedKg,
        kind: "number",
        width: 120,
        className: "text-right font-mono tabular-nums",
        render: (q) => q.shippedKg ?? "",
      },
      {
        key: "source",
        header: t.source,
        kind: "enum",
        width: 90,
        className: "text-xs",
        render: (q) => m.prtr.sources[q.source],
      },
      {
        key: "updatedAt",
        header: t.updatedAt,
        kind: "date",
        width: 150,
        className: "text-muted-foreground text-xs",
        render: (q) => new Date(q.updatedAt).toLocaleString(locale),
      },
    ],
    [t, m, locale, canSeeProducts],
  );
  const { state, setState } = useTableState(Q_KEY, columns, Q_STATE);

  async function save() {
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const editing = form.id !== "";
      const res = await fetch(
        editing
          ? `/api/prtr/entries/${entryId}/quantities/${form.id}`
          : `/api/prtr/entries/${entryId}/quantities`,
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productCode: form.productCode,
            purchasedKg: form.purchasedKg,
            shippedKg: form.shippedKg || null,
          }),
        },
      );
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        setFieldErrors(toFieldErrors(body?.error.details));
        return;
      }
      setOpen(false);
      setForm({ id: "", productCode: "", purchasedKg: "", shippedKg: "" });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected(selected: PrtrQuantityDto[]) {
    setError(null);
    for (const q of selected) {
      const res = await fetch(`/api/prtr/entries/${entryId}/quantities/${q.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    await onChanged();
  }

  return (
    <Card defaultOpen>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{t.title}</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">
            {method === "MEASURED" ? t.shippedOptional : t.shippedRequired}
          </p>
        </div>
        <div className="flex gap-2">
          <FilePickButton label={m.prtr.import.button} onPick={setImporting} />
          {!open && (
            <Button
              size="sm"
              onClick={() => {
                setForm({ id: "", productCode: "", purchasedKg: "", shippedKg: "" });
                setOpen(true);
              }}
            >
              {t.add}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {open && (
          <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
            <div className="w-40 space-y-1">
              <Label htmlFor="q-code">{t.productCode}</Label>
              <Input
                id="q-code"
                value={form.productCode}
                maxLength={20}
                disabled={form.id !== ""}
                onChange={(e) => setForm({ ...form, productCode: e.target.value })}
                aria-invalid={Boolean(firstError(fieldErrors, "productCode"))}
                className="h-8 font-mono"
              />
              <FieldError message={firstError(fieldErrors, "productCode")} />
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor="q-purchased">{t.purchasedKg}</Label>
              <Input
                id="q-purchased"
                inputMode="decimal"
                value={form.purchasedKg}
                onChange={(e) => setForm({ ...form, purchasedKg: e.target.value })}
                aria-invalid={Boolean(firstError(fieldErrors, "purchasedKg"))}
                className="h-8 font-mono"
              />
              <FieldError message={firstError(fieldErrors, "purchasedKg")} />
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor="q-shipped">{t.shippedKg}</Label>
              <Input
                id="q-shipped"
                inputMode="decimal"
                value={form.shippedKg}
                onChange={(e) => setForm({ ...form, shippedKg: e.target.value })}
                aria-invalid={Boolean(firstError(fieldErrors, "shippedKg"))}
                className="h-8 font-mono"
              />
              <FieldError message={firstError(fieldErrors, "shippedKg")} />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={
                  saving || form.productCode.trim() === "" || form.purchasedKg.trim() === ""
                }
                onClick={() => void save()}
              >
                {saving ? m.common.saving : m.common.save}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                {m.common.cancel}
              </Button>
            </div>
          </div>
        )}
        <DataTable
          storageKey={Q_KEY}
          columns={columns}
          rows={rows}
          rowKey={(q) => q.id}
          total={rows.length}
          state={state}
          defaultState={Q_STATE}
          onStateChange={setState}
          emptyMessage={t.empty}
          showPager={false}
          showFilters={false}
          selectable
          onDeleteSelected={(sel) => void removeSelected(sel)}
          rowAction={{
            onClick: (q) => {
              setForm({
                id: q.id,
                productCode: q.productCode,
                purchasedKg: q.purchasedKg,
                shippedKg: q.shippedKg ?? "",
              });
              setOpen(true);
            },
          }}
        />
      </CardContent>
      {importing && (
        <PrtrImportDialog
          entryId={entryId}
          kind="quantities"
          file={importing}
          shippedRequired={method !== "MEASURED"}
          onClose={(applied) => {
            setImporting(null);
            if (applied) void onChanged();
          }}
        />
      )}
    </Card>
  );
}

/** 実測値（方法が実測値のときだけ） */
function MeasuredSection({
  entryId,
  rows,
  onChanged,
}: {
  entryId: string;
  rows: PrtrMeasuredDto[];
  onChanged: () => Promise<void>;
}) {
  const { m, locale } = useI18n();
  const t = m.prtr.measured;
  const [form, setForm] = useState({ id: "", substanceCode: "", measuredKg: "" });
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);

  const columns = useMemo<TableColumn<PrtrMeasuredDto>[]>(
    () => [
      {
        key: "officialNumber",
        header: m.statutorySubstances.officialNumber,
        kind: "text",
        width: 130,
        className: "font-mono text-xs",
        render: (x) => x.officialNumber ?? "",
      },
      {
        key: "statutoryName",
        header: t.statutoryName,
        kind: "text",
        width: 280,
        render: (x) =>
          pickStatutoryName(locale, x.statutoryNameOriginal, x.statutoryNameJa, x.statutoryNameEn),
      },
      {
        key: "substanceCode",
        header: t.substanceCode,
        kind: "text",
        width: 200,
        className: "text-xs",
        render: (x) =>
          x.substanceCode ? (
            <>
              <span className="font-mono">{x.substanceCode}</span>
              <span className="text-muted-foreground ml-2">{x.substanceNameJa}</span>
            </>
          ) : (
            ""
          ),
      },
      {
        key: "measuredKg",
        header: t.measuredKg,
        kind: "number",
        width: 120,
        className: "text-right font-mono tabular-nums",
        render: (x) => x.measuredKg,
      },
      {
        key: "source",
        header: m.prtr.quantities.source,
        kind: "enum",
        width: 90,
        className: "text-xs",
        render: (x) => m.prtr.sources[x.source],
      },
    ],
    [t, m, locale],
  );
  const { state, setState } = useTableState(M_KEY, columns, M_STATE);

  async function save() {
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const editing = form.id !== "";
      const res = await fetch(
        editing
          ? `/api/prtr/entries/${entryId}/measured/${form.id}`
          : `/api/prtr/entries/${entryId}/measured`,
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editing
              ? { measuredKg: form.measuredKg }
              : { substanceCode: form.substanceCode, measuredKg: form.measuredKg },
          ),
        },
      );
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        setFieldErrors(toFieldErrors(body?.error.details));
        return;
      }
      setOpen(false);
      setForm({ id: "", substanceCode: "", measuredKg: "" });
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected(selected: PrtrMeasuredDto[]) {
    setError(null);
    for (const x of selected) {
      const res = await fetch(`/api/prtr/entries/${entryId}/measured/${x.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        break;
      }
    }
    await onChanged();
  }

  return (
    <Card defaultOpen>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{t.title}</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">{m.prtr.methodHints.MEASURED}</p>
        </div>
        <div className="flex gap-2">
          <FilePickButton label={m.prtr.import.button} onPick={setImporting} />
          {!open && (
            <Button
              size="sm"
              onClick={() => {
                setForm({ id: "", substanceCode: "", measuredKg: "" });
                setOpen(true);
              }}
            >
              {t.add}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {open && (
          <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
            <div className="w-48 space-y-1">
              <Label htmlFor="ms-code">{t.substanceCode}</Label>
              <Input
                id="ms-code"
                value={form.substanceCode}
                maxLength={50}
                disabled={form.id !== ""}
                onChange={(e) => setForm({ ...form, substanceCode: e.target.value })}
                aria-invalid={Boolean(firstError(fieldErrors, "substanceCode"))}
                className="h-8 font-mono"
              />
              <FieldError message={firstError(fieldErrors, "substanceCode")} />
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor="ms-kg">{t.measuredKg}</Label>
              <Input
                id="ms-kg"
                inputMode="decimal"
                value={form.measuredKg}
                onChange={(e) => setForm({ ...form, measuredKg: e.target.value })}
                aria-invalid={Boolean(firstError(fieldErrors, "measuredKg"))}
                className="h-8 font-mono"
              />
              <FieldError message={firstError(fieldErrors, "measuredKg")} />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={
                  saving ||
                  (form.id === "" && form.substanceCode.trim() === "") ||
                  form.measuredKg.trim() === ""
                }
                onClick={() => void save()}
              >
                {saving ? m.common.saving : m.common.save}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                {m.common.cancel}
              </Button>
            </div>
          </div>
        )}
        <DataTable
          storageKey={M_KEY}
          columns={columns}
          rows={rows}
          rowKey={(x) => x.id}
          total={rows.length}
          state={state}
          defaultState={M_STATE}
          onStateChange={setState}
          emptyMessage={t.empty}
          showPager={false}
          showFilters={false}
          selectable
          onDeleteSelected={(sel) => void removeSelected(sel)}
          rowAction={{
            onClick: (x) => {
              setForm({ id: x.id, substanceCode: x.substanceCode ?? "", measuredKg: x.measuredKg });
              setOpen(true);
            },
          }}
        />
      </CardContent>
      {importing && (
        <PrtrImportDialog
          entryId={entryId}
          kind="measured"
          file={importing}
          onClose={(applied) => {
            setImporting(null);
            if (applied) void onChanged();
          }}
        />
      )}
    </Card>
  );
}
