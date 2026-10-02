"use client";

import {
  defaultPrtrFiscalYear,
  emptyTableState,
  normalizeCode,
  pickName,
  pickStatutoryName,
  serializeTableState,
  type PrtrProductMethod,
  type TableState,
} from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { FieldError } from "@/components/field-error";
import { PrtrImportDialog } from "@/components/prtr-import-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { firstError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { useI18n } from "@/lib/i18n-client";
import type {
  ApiError,
  ListResponse,
  PrtrEntryDto,
  PrtrMeasuredDto,
  ProductListItemDto,
  PrtrQuantityDto,
  PrtrScopeDto,
  PrtrSubstanceCandidateDto,
  PrtrSummaryDto,
  PrtrSummaryRowDto,
} from "@/lib/types";
import { useMe } from "@/lib/use-me";
import { useTableState } from "@/lib/use-table-state";

const Q_KEY = "chem.table.prtrQuantities";
const M_KEY = "chem.table.prtrMeasured";

const Q_STATE: TableState = emptyTableState([{ column: "productCode", direction: "asc" }]);
const M_STATE: TableState = emptyTableState([{ column: "officialNumber", direction: "asc" }]);
const S_KEY = "chem.table.prtrSummary";
/** 既定の並びは API 側（法文物質名の表示順）。番号の列で並べると文字の順になる */
const S_STATE: TableState = emptyTableState([]);

const SELECT = "border-input bg-background h-8 rounded-none border px-2 text-sm";
/** 取り込めるファイル。OS の選択画面ではこれだけ選べる */
const IMPORT_ACCEPT = ".csv,.tsv,.txt,.xlsx";
/** 検索の候補の上限 */
const FIND_SIZE = 20;

/**
 * 取り込み用のテンプレート（Excel）を落とす。表ごと（物質収支の製品・排出係数の製品・実測値の物質）に
 * シートが分かれて 1 つに入っている。各シートの 1 行目の見出しが、そのまま列の割り当てに当たる
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

/** 「インポート」ボタン。押すと OS のファイル選択が開き、選ぶと取り込みの窓が開く */
function FilePickButton({
  label,
  disabled,
  onPick,
}: {
  label: string;
  disabled?: boolean;
  onPick: (f: File) => void;
}) {
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
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => ref.current?.click()}>
        {label}
      </Button>
    </>
  );
}

/**
 * PRTR 届出データの入力（S22。2026-10-02 設計）。
 *
 * 所属と年度を選んで保存すると、排出量の計算方法ごとの区画が出る:
 *   1. 物質収支（製品ごとの取扱量・出荷量）
 *   2. 排出係数（係数と、製品ごとの取扱量・出荷量）
 *   3. 実測値（物質ごとの取扱量・排出量）
 * 下の「排出量集計」が 3 つを物質ごとに足す。集計は「保存」で写しを残し、「確定」で入力を読み取り専用にする。
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

  // 頭（係数・備考）。係数は排出係数の区画で入れるが、保存は頭と同じ API（両方とも毎回送る）
  const [factorPct, setFactorPct] = useState("");
  const [note, setNote] = useState("");
  const [headErrors, setHeadErrors] = useState<FieldErrors>({});
  const [savingHead, setSavingHead] = useState(false);
  /** 数量が変わるたびに増やし、集計を読み直す合図にする */
  const [tick, setTick] = useState(0);

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
    setTick((n) => n + 1);
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
    setFactorPct(body.entry?.factorPct ?? "");
    setNote(body.entry?.note ?? "");
    setHeadErrors({});
  }, [orgId, fiscalYear, m]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 頭（係数・備考）を保存する。頭の「保存」と、排出係数の区画の「保存」の両方から呼ぶ */
  async function saveHead(savedMessage: string) {
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
      setNotice(savedMessage);
      setTick((n) => n + 1);
    } finally {
      setSavingHead(false);
    }
  }

  const entry = data?.entry ?? null;
  /** 集計が確定している。入力は読み取り専用 */
  const locked = data?.confirmed ?? false;

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

      {/* 白い箱が複数あるので、どれも開閉できる（システム共通の決まり）。最初は全部開いておく */}
      <Card defaultOpen>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{t.title}</CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">{t.lead}</p>
          </div>
          <TemplateButton />
        </CardHeader>
        <CardContent className="space-y-4">
          {locked && (
            <Alert>
              <AlertDescription>{t.locked}</AlertDescription>
            </Alert>
          )}
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
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor="prtr-note">{t.note}</Label>
              <Input
                id="prtr-note"
                value={note}
                maxLength={2000}
                disabled={locked}
                onChange={(e) => setNote(e.target.value)}
                className="h-8"
              />
            </div>
            <Button
              size="sm"
              disabled={savingHead || !orgId || locked}
              onClick={() => void saveHead(t.headerSaved)}
            >
              {savingHead ? m.common.saving : m.common.save}
            </Button>
          </div>

          {entry && (
            <>
              {/* 1. 物質収支 */}
              <section className="space-y-3 border-t pt-4">
                <div>
                  <p className="text-base font-semibold">1. {t.methods.BALANCE}</p>
                  <p className="text-muted-foreground mt-1 text-sm">{t.methodHints.BALANCE}</p>
                </div>
                <QuantitySection
                  entryId={entry.id}
                  method="BALANCE"
                  locked={locked}
                  canSeeProducts={can("PRODUCT_VIEW")}
                  onChanged={load}
                />
              </section>

              {/* 2. 排出係数 */}
              <section className="space-y-3 border-t pt-4">
                <div>
                  <p className="text-base font-semibold">2. {t.methods.FACTOR}</p>
                  <p className="text-muted-foreground mt-1 text-sm">{t.methodHints.FACTOR}</p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="prtr-factor">{t.factorPct}</Label>
                    <Input
                      id="prtr-factor"
                      inputMode="decimal"
                      value={factorPct}
                      disabled={locked}
                      onChange={(e) => setFactorPct(e.target.value)}
                      aria-invalid={Boolean(firstError(headErrors, "factorPct"))}
                      className="h-8 w-32 font-mono"
                    />
                    <FieldError message={firstError(headErrors, "factorPct")} />
                  </div>
                  <Button
                    size="sm"
                    disabled={savingHead || locked}
                    onClick={() => void saveHead(t.factorSaved)}
                  >
                    {savingHead ? m.common.saving : m.common.save}
                  </Button>
                  <span className="text-muted-foreground pb-2 text-xs">{t.factorHint}</span>
                </div>
                <QuantitySection
                  entryId={entry.id}
                  method="FACTOR"
                  locked={locked}
                  canSeeProducts={can("PRODUCT_VIEW")}
                  onChanged={load}
                />
              </section>

              {/* 3. 実測値 */}
              <section className="space-y-3 border-t pt-4">
                <div>
                  <p className="text-base font-semibold">3. {t.methods.MEASURED}</p>
                  <p className="text-muted-foreground mt-1 text-sm">{t.methodHints.MEASURED}</p>
                </div>
                <MeasuredSection entryId={entry.id} locked={locked} onChanged={load} />
              </section>
            </>
          )}
        </CardContent>
      </Card>

      {/* 排出量集計は入力の下の別のカード */}
      {entry && <SummarySection entryId={entry.id} tick={tick} onChanged={load} />}
    </div>
  );
}

/**
 * 排出量集計（第一種指定化学物質ごと）。開いたとき・数量が変わったときに「いまの集計」を作り直して出す。
 * 「保存」で写し（保存した集計・未確定）を残し、「確定」で入力を読み取り専用にする。「未確定に戻す」で戻す
 */
function SummarySection({
  entryId,
  tick,
  onChanged,
}: {
  entryId: string;
  tick: number;
  /** 確定・解除で入力の読み取り専用が変わるので、上に知らせる */
  onChanged: () => Promise<void>;
}) {
  const { m, locale } = useI18n();
  const t = m.prtr.summary;
  const ask = useConfirm();
  const [data, setData] = useState<PrtrSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [acting, setActing] = useState(false);
  /** 集計し直した回数。増えると一覧を読み直す */
  const [computed, setComputed] = useState(0);
  /** 保存した集計を見ているか（既定はいまの集計） */
  const [viewSaved, setViewSaved] = useState(false);

  const columns = useMemo<TableColumn<PrtrSummaryRowDto>[]>(
    () => [
      {
        key: "officialNumber",
        header: t.officialNumber,
        kind: "text",
        width: 130,
        className: "font-mono text-xs",
        render: (r) => r.officialNumber ?? "",
      },
      {
        key: "name",
        header: t.name,
        kind: "text",
        width: 300,
        render: (r) => pickStatutoryName(locale, r.nameOriginal, r.nameJa, r.nameEn),
      },
      {
        key: "kind",
        header: t.kind,
        kind: "enum",
        width: 100,
        className: "text-xs",
        options: [
          { value: "C1", label: t.kindClass1 },
          { value: "SC1", label: t.kindSpecific },
        ],
        render: (r) => (r.specific ? t.kindSpecific : t.kindClass1),
      },
      {
        key: "productCount",
        header: t.productCount,
        kind: "number",
        width: 70,
        className: "text-right text-xs",
        render: (r) => String(r.productCount),
      },
      {
        key: "handledKg",
        header: t.handledKg,
        kind: "number",
        width: 130,
        className: "text-right font-mono tabular-nums",
        render: (r) => r.handledKg,
      },
      {
        key: "releaseKg",
        header: t.releaseKg,
        kind: "number",
        width: 130,
        className: "text-right font-mono tabular-nums",
        render: (r) => r.releaseKg ?? "",
      },
      // 排出量の内訳（物質収支／排出係数／実測値）。どの方法から来た量か分かるように
      {
        key: "releaseBalanceKg",
        header: t.releaseBalanceKg,
        kind: "number",
        width: 130,
        className: "text-muted-foreground text-right font-mono text-xs tabular-nums",
        render: (r) => r.releaseBalanceKg ?? "",
      },
      {
        key: "releaseFactorKg",
        header: t.releaseFactorKg,
        kind: "number",
        width: 130,
        className: "text-muted-foreground text-right font-mono text-xs tabular-nums",
        render: (r) => r.releaseFactorKg ?? "",
      },
      {
        key: "releaseMeasuredKg",
        header: t.releaseMeasuredKg,
        kind: "number",
        width: 130,
        className: "text-muted-foreground text-right font-mono text-xs tabular-nums",
        render: (r) => r.releaseMeasuredKg ?? "",
      },
      {
        key: "needsReport",
        header: t.needsReport,
        kind: "enum",
        width: 90,
        className: "text-center",
        options: [
          { value: "yes", label: t.needsReportYes },
          { value: "no", label: t.needsReportNo },
        ],
        render: (r) =>
          r.needsReport ? (
            <Badge variant="destructive">{t.needsReportYes}</Badge>
          ) : (
            <span className="text-muted-foreground">{t.needsReportNo}</span>
          ),
      },
    ],
    [t, locale],
  );
  const { state, setState } = useTableState(S_KEY, columns, S_STATE, "s");

  const showError = useCallback(
    async (res: Response | null) => {
      if (!res) return;
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
    },
    [m],
  );

  /** いまの集計を作り直す。開いたとき、数量が変わったとき、「再計算」を押したとき */
  const compute = useCallback(async () => {
    setComputing(true);
    try {
      const res = await fetch(`/api/prtr/entries/${entryId}/summary`, { method: "POST" }).catch(
        () => null,
      );
      if (!res?.ok) {
        await showError(res);
        return;
      }
      setError(null);
      setComputed((n) => n + 1);
    } finally {
      setComputing(false);
    }
  }, [entryId, showError]);

  useEffect(() => {
    void compute();
  }, [compute, tick]);

  // 行を、表の状態（絞り込み・並べ替え・ページ）で読む。保存した集計を見ているときはその行
  useEffect(() => {
    void (async () => {
      const params = serializeTableState(state, S_STATE);
      if (viewSaved) params.set("saved", "1");
      const res = await fetch(`/api/prtr/entries/${entryId}/summary?${params.toString()}`).catch(
        () => null,
      );
      if (!res?.ok) {
        await showError(res);
        return;
      }
      setData((await res.json()) as PrtrSummaryDto);
    })();
  }, [entryId, state, computed, viewSaved, showError]);

  /** 保存・確定・未確定に戻す */
  async function act(action: "save" | "confirm" | "unconfirm") {
    if (action === "confirm" && !(await ask({ message: t.confirmAsk, confirmLabel: t.confirm })))
      return;
    if (
      action === "unconfirm" &&
      !(await ask({ message: t.unconfirmAsk, confirmLabel: t.unconfirm }))
    )
      return;
    setError(null);
    setNotice(null);
    setActing(true);
    try {
      const res = await fetch(`/api/prtr/entries/${entryId}/summary/${action}`, {
        method: "POST",
      }).catch(() => null);
      if (!res?.ok) {
        await showError(res);
        return;
      }
      setNotice(action === "save" ? t.saved : action === "confirm" ? t.confirmed : t.unconfirmed);
      setComputed((n) => n + 1);
      // 確定・解除で入力の読み取り専用が変わる。保存はいまの集計も作り直している
      await onChanged();
    } finally {
      setActing(false);
    }
  }

  const head = data?.summary ?? null;
  const confirmed = head?.confirmedAt != null;

  return (
    <Card defaultOpen>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{t.title}</CardTitle>
          <p className="text-muted-foreground mt-1 text-sm">{t.lead}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            {head
              ? [
                  t.computedAt(new Date(head.computedAt).toLocaleString(locale)),
                  head.versionCode ? t.versionLabel(head.versionCode) : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : t.notComputed}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={computing} onClick={() => void compute()}>
          {computing ? t.computing : t.recompute}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
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
        {head && head.unjudgedProducts > 0 && (
          <Alert>
            <AlertDescription>{t.unjudged(head.unjudgedProducts)}</AlertDescription>
          </Alert>
        )}
        {head && head.factorMissing && (
          <Alert variant="destructive">
            <AlertDescription>{t.factorMissing}</AlertDescription>
          </Alert>
        )}
        {/*
          保存と確定（2026-10-02 設計）。保存した集計の状態を 1 行で出し、右にボタン。
          未保存の変更があれば知らせる。保存した集計はボタンで見られる
        */}
        {head && (
          <div className="flex flex-wrap items-center gap-3 border-b pb-3 text-sm">
            <span>
              {head.savedAt
                ? `${t.savedAt(new Date(head.savedAt).toLocaleString(locale))}（${
                    confirmed ? t.statusConfirmed : t.statusDraft
                  }）`
                : t.notSaved}
              {confirmed && head.confirmedAt && (
                <span className="text-muted-foreground ml-2 text-xs">
                  {t.confirmedAt(new Date(head.confirmedAt).toLocaleString(locale))}
                </span>
              )}
            </span>
            {head.savedAt && head.unsavedChanges && !confirmed && (
              <Badge variant="destructive">{t.unsavedChanges}</Badge>
            )}
            <span className="flex-1" />
            {head.savedAt && (
              <Button size="sm" variant="outline" onClick={() => setViewSaved((v) => !v)}>
                {viewSaved ? t.showCurrent : t.showSaved}
              </Button>
            )}
            {!confirmed && (
              <Button size="sm" disabled={acting} onClick={() => void act("save")}>
                {t.save}
              </Button>
            )}
            {!confirmed && head.savedAt && (
              <Button
                size="sm"
                variant="outline"
                disabled={acting || head.unsavedChanges}
                title={head.unsavedChanges ? t.unsavedChanges : undefined}
                onClick={() => void act("confirm")}
              >
                {t.confirm}
              </Button>
            )}
            {confirmed && (
              <Button
                size="sm"
                variant="outline"
                disabled={acting}
                onClick={() => void act("unconfirm")}
              >
                {t.unconfirm}
              </Button>
            )}
          </div>
        )}
        {viewSaved && head?.savedAt && (
          <p className="text-muted-foreground text-xs">
            {t.viewingSaved}
            {head.savedVersionCode ? ` ${t.versionLabel(head.savedVersionCode)}` : ""}
          </p>
        )}
        <DataTable
          storageKey={S_KEY}
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.statutorySubstanceId}
          total={data?.total ?? 0}
          state={state}
          defaultState={S_STATE}
          onStateChange={setState}
          emptyMessage={t.empty}
        />
        {head && (
          <p className="text-muted-foreground text-xs">
            {t.releaseFormula}。{t.thresholdNote(head.thresholdKg, head.thresholdSpecificKg)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** 製品ごとの数量（物質収支・排出係数の区画。区画ごとに別の表） */
function QuantitySection({
  entryId,
  method,
  locked,
  canSeeProducts,
  onChanged,
}: {
  entryId: string;
  /** この表の区画。行はこの区画で登録し、読むときもこの区画の行だけ */
  method: PrtrProductMethod;
  /** 集計が確定している（読み取り専用） */
  locked: boolean;
  canSeeProducts: boolean;
  /** 件数が変わったことを上に知らせる（集計の読み直しに使う） */
  onChanged: () => Promise<void>;
}) {
  const { m, locale } = useI18n();
  const t = m.prtr.quantities;
  const [data, setData] = useState<ListResponse<PrtrQuantityDto> | null>(null);
  const emptyForm = { id: "", productCode: "", purchasedKg: "", shippedKg: "" };
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState<File | null>(null);
  /*
    製品を探して選ぶ（2026-09-30 指示）。追加行の上に置く。コードは打たなくても、コードの一部か名称で探して
    「選択」を押せば製品コードに入る。製品の一覧の API（PRODUCT_VIEW）を引くので、見られる人にだけ出す
  */
  const [find, setFind] = useState({ code: "", name: "" });
  const [found, setFound] = useState<{ items: ProductListItemDto[]; total: number } | null>(null);
  const [finding, setFinding] = useState(false);
  const purchasedRef = useRef<HTMLInputElement>(null);
  /**
   * 製品名（読み取り専用）。製品コードが変わるたびに引いて入れる。
   * null＝まだ引いていない／コードが空、""＝そのコードの製品が無い
   */
  const [productName, setProductName] = useState<string | null>(null);
  useEffect(() => {
    const code = form.productCode.trim();
    if (code === "") {
      setProductName(null);
      return;
    }
    // 製品を見られない人は引けない（直す行では、行が持つ名前をそのまま出す）
    if (!canSeeProducts) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        const params = new URLSearchParams({ size: "1", "f.code": `equals:${code}` });
        const res = await fetch(`/api/products?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as ListResponse<ProductListItemDto>;
        const hit = body.items.find((p) => normalizeCode(p.code) === normalizeCode(code));
        if (!cancelled) setProductName(hit ? pickName(locale, hit.nameJa, hit.nameEn) : "");
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [form.productCode, canSeeProducts, locale]);

  /*
    打つたびに探す（「検索」ボタンは無し）。打ち終わりを 300 ms 待ってから引き、
    遅れて返った古い結果は捨てる。両方空なら候補を消す
  */
  useEffect(() => {
    const code = find.code.trim();
    const name = find.name.trim();
    if (code === "" && name === "") {
      setFound(null);
      setFinding(false);
      return;
    }
    let cancelled = false;
    setFinding(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ size: String(FIND_SIZE) });
          if (code) params.set("f.code", `contains:${code}`);
          // 名称は画面の言語の側で探す（日本語のときは日本語名、英語のときは英語名）
          if (name) params.set(locale === "ja" ? "f.nameJa" : "f.nameEn", `contains:${name}`);
          const res = await fetch(`/api/products?${params.toString()}`);
          if (cancelled) return;
          if (!res.ok) {
            if (redirectIfUnauthorized(res)) return;
            setFound({ items: [], total: 0 });
            return;
          }
          const body = (await res.json()) as ListResponse<ProductListItemDto>;
          if (!cancelled) setFound({ items: body.items, total: body.total });
        } finally {
          if (!cancelled) setFinding(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [find.code, find.name, locale]);

  /** 探した製品を選ぶ。製品コードに入れて、取扱量の欄へ進む */
  function pickProduct(p: ProductListItemDto) {
    setForm((prev) => ({ ...prev, productCode: p.code }));
    setProductName(pickName(locale, p.nameJa, p.nameEn));
    setFieldErrors({});
    purchasedRef.current?.focus();
  }
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
        width: 300,
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
        options: [
          { value: "MANUAL", label: m.prtr.sources.MANUAL },
          { value: "IMPORT", label: m.prtr.sources.IMPORT },
        ],
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
  // 表の状態は区画ごとに覚える（同じ鍵だと、もう一方の表のページや絞り込みを引き継ぐ）
  const { state, setState } = useTableState(
    `${Q_KEY}.${method}`,
    columns,
    Q_STATE,
    method === "FACTOR" ? "qf" : "qb",
  );

  const loadRows = useCallback(async () => {
    const params = serializeTableState(state, Q_STATE);
    params.set("method", method);
    const res = await fetch(`/api/prtr/entries/${entryId}/quantities?${params.toString()}`).catch(
      () => null,
    );
    if (!res?.ok) {
      if (res) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
      }
      return;
    }
    setData((await res.json()) as ListResponse<PrtrQuantityDto>);
  }, [entryId, method, state, m]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  /** 行を足した・直した・消したあと。表と、上の件数の両方を読み直す */
  const changed = async () => {
    await Promise.all([loadRows(), onChanged()]);
  };

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
            method,
            productCode: form.productCode,
            purchasedKg: form.purchasedKg,
            shippedKg: form.shippedKg,
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
      setForm(emptyForm);
      await changed();
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
    await changed();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-row items-center justify-between gap-3">
        <p className="text-sm font-medium">{t.title}</p>
        <FilePickButton label={m.prtr.import.button} disabled={locked} onPick={setImporting} />
      </div>
      <div className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {open && canSeeProducts && form.id === "" && (
          <div className="border-border bg-muted/30 space-y-2 border p-3">
            <p className="text-sm font-medium">{t.find.title}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40 space-y-1">
                <Label htmlFor={`q-${method}-find-code`}>{t.productCode}</Label>
                <Input
                  id={`q-${method}-find-code`}
                  value={find.code}
                  autoComplete="off"
                  onChange={(e) => setFind({ ...find, code: e.target.value })}
                  className="h-8 font-mono"
                />
              </div>
              <div className="w-64 space-y-1">
                <Label htmlFor={`q-${method}-find-name`}>{t.find.name}</Label>
                <Input
                  id={`q-${method}-find-name`}
                  value={find.name}
                  autoComplete="off"
                  onChange={(e) => setFind({ ...find, name: e.target.value })}
                  className="h-8"
                />
              </div>
              {finding && (
                <span className="text-muted-foreground pb-2 text-xs">{t.find.searching}</span>
              )}
            </div>
            {found !== null &&
              (found.items.length === 0 ? (
                <p className="text-muted-foreground text-xs">{t.find.none}</p>
              ) : (
                <div className="space-y-1">
                  <ul className="divide-border bg-background max-h-56 divide-y overflow-y-auto border">
                    {found.items.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-2 py-1 text-sm">
                        <span className="w-40 shrink-0 font-mono text-xs">{p.code}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {pickName(locale, p.nameJa, p.nameEn)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          aria-label={`${t.find.pick} ${p.code}`}
                          onClick={() => pickProduct(p)}
                        >
                          {t.find.pick}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {found.total > found.items.length && (
                    <p className="text-muted-foreground text-xs">
                      {t.find.more(found.total - found.items.length)}
                    </p>
                  )}
                </div>
              ))}
          </div>
        )}
        {open && (
          <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
            <div className="w-40 space-y-1">
              <Label htmlFor={`q-${method}-code`}>{t.productCode}</Label>
              <Input
                id={`q-${method}-code`}
                value={form.productCode}
                maxLength={20}
                disabled={form.id !== ""}
                onChange={(e) => setForm({ ...form, productCode: e.target.value })}
                aria-invalid={Boolean(firstError(fieldErrors, "productCode"))}
                className="h-8 font-mono"
              />
              <FieldError message={firstError(fieldErrors, "productCode")} />
            </div>
            {/* 製品名は読むだけ。コードを入れると自動で入る。無いコードなら断りを出す */}
            <div className="min-w-64 flex-1 space-y-1">
              <Label htmlFor={`q-${method}-name`}>{t.productName}</Label>
              <Input
                id={`q-${method}-name`}
                value={productName ?? ""}
                readOnly
                tabIndex={-1}
                className="bg-muted/50 h-8"
              />
              {productName === "" && (
                <p className="text-destructive text-xs">
                  {t.productNotFound(form.productCode.trim())}
                </p>
              )}
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor={`q-${method}-purchased`}>{t.purchasedKg}</Label>
              <Input
                ref={purchasedRef}
                id={`q-${method}-purchased`}
                inputMode="decimal"
                value={form.purchasedKg}
                onChange={(e) => setForm({ ...form, purchasedKg: e.target.value })}
                aria-invalid={Boolean(firstError(fieldErrors, "purchasedKg"))}
                className="h-8 font-mono"
              />
              <FieldError message={firstError(fieldErrors, "purchasedKg")} />
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor={`q-${method}-shipped`}>{t.shippedKg}</Label>
              <Input
                id={`q-${method}-shipped`}
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
                  saving ||
                  form.productCode.trim() === "" ||
                  form.purchasedKg.trim() === "" ||
                  form.shippedKg.trim() === ""
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
          storageKey={`${Q_KEY}.${method}`}
          // 1 件登録は、ほかの一覧と同じ表の上の「＋」から。確定中は出さない
          create={
            !open && !locked
              ? {
                  label: t.add,
                  onClick: () => {
                    setForm(emptyForm);
                    setFind({ code: "", name: "" });
                    setFound(null);
                    setOpen(true);
                  },
                }
              : undefined
          }
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(q) => q.id}
          total={data?.total ?? 0}
          state={state}
          defaultState={Q_STATE}
          onStateChange={setState}
          emptyMessage={t.empty}
          selectable={!locked}
          onDeleteSelected={locked ? undefined : (sel) => void removeSelected(sel)}
          rowAction={
            locked
              ? undefined
              : {
                  onClick: (q) => {
                    setForm({
                      id: q.id,
                      productCode: q.productCode,
                      purchasedKg: q.purchasedKg,
                      shippedKg: q.shippedKg ?? "",
                    });
                    setProductName(pickName(locale, q.productNameJa, q.productNameEn));
                    setOpen(true);
                  },
                }
          }
        />
      </div>
      {importing && (
        <PrtrImportDialog
          entryId={entryId}
          kind="quantities"
          method={method}
          file={importing}
          onClose={(applied) => {
            setImporting(null);
            if (applied) void changed();
          }}
        />
      )}
    </div>
  );
}

/** 実測値の区画: 物質ごとの取扱量（任意）と排出量 */
function MeasuredSection({
  entryId,
  locked,
  onChanged,
}: {
  entryId: string;
  locked: boolean;
  onChanged: () => Promise<void>;
}) {
  const { m, locale } = useI18n();
  const t = m.prtr.measured;
  const [data, setData] = useState<ListResponse<PrtrMeasuredDto> | null>(null);
  const emptyForm = { id: "", substanceCode: "", handledKg: "", measuredKg: "" };
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  /*
    物質検索（2026-10-02 設計）。コードの一部・CAS・名称で探し、第一種指定化学物質に当たる物質だけが並ぶ。
    「選択」で物質コードが入る。打つたびに探す（300 ms 待ち、古い結果は捨てる）
  */
  const [find, setFind] = useState({ code: "", cas: "", name: "" });
  const [found, setFound] = useState<PrtrSubstanceCandidateDto[] | null>(null);
  const [finding, setFinding] = useState(false);
  /** 物質コードから引いた「物質名 → 第一種指定化学物質」。null＝未照会、""＝当たらない */
  const [resolved, setResolved] = useState<string | null>(null);
  const handledRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const code = find.code.trim();
    const cas = find.cas.trim();
    const name = find.name.trim();
    if (code === "" && cas === "" && name === "") {
      setFound(null);
      setFinding(false);
      return;
    }
    let cancelled = false;
    setFinding(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ code, cas, name });
          const res = await fetch(`/api/prtr/substances?${params.toString()}`);
          if (cancelled) return;
          if (!res.ok) {
            if (redirectIfUnauthorized(res)) return;
            setFound([]);
            return;
          }
          const body = (await res.json()) as { items: PrtrSubstanceCandidateDto[] };
          if (!cancelled) setFound(body.items);
        } finally {
          if (!cancelled) setFinding(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [find.code, find.cas, find.name]);

  // 物質コードを打ったときも、同じ検索で名前と第一種指定化学物質を引いて読み取り専用の欄に出す
  useEffect(() => {
    const code = form.substanceCode.trim();
    if (code === "" || form.id !== "") {
      if (code === "") setResolved(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        const params = new URLSearchParams({ code, cas: "", name: "" });
        const res = await fetch(`/api/prtr/substances?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { items: PrtrSubstanceCandidateDto[] };
        const hit = body.items.find((s) => normalizeCode(s.code) === normalizeCode(code));
        if (!cancelled) setResolved(hit ? labelOf(hit) : "");
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labelOf は locale だけに依る
  }, [form.substanceCode, form.id, locale]);

  /** 候補の 1 行の文字: 物質名 → 法律上の番号 第一種指定化学物質 */
  const labelOf = (s: PrtrSubstanceCandidateDto) =>
    `${pickName(locale, s.nameJa, s.nameEn)} → ${[s.officialNumber, pickStatutoryName(locale, s.statutoryNameOriginal, s.statutoryNameJa, null)].filter(Boolean).join(" ")}`;

  function pickSubstance(s: PrtrSubstanceCandidateDto) {
    setForm((prev) => ({ ...prev, substanceCode: s.code }));
    setResolved(labelOf(s));
    setFieldErrors({});
    handledRef.current?.focus();
  }

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
        width: 260,
        render: (x) =>
          pickStatutoryName(locale, x.statutoryNameOriginal, x.statutoryNameJa, x.statutoryNameEn),
      },
      {
        key: "substanceCode",
        header: t.substanceCode,
        kind: "text",
        width: 120,
        className: "font-mono text-xs",
        render: (x) => x.substanceCode ?? "",
      },
      {
        key: "substanceName",
        header: t.substanceName,
        kind: "text",
        width: 200,
        render: (x) => x.substanceNameJa ?? "",
      },
      {
        key: "handledKg",
        header: t.handledKg,
        kind: "number",
        width: 120,
        className: "text-right font-mono tabular-nums",
        render: (x) => x.handledKg ?? "",
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
        options: [
          { value: "MANUAL", label: m.prtr.sources.MANUAL },
          { value: "IMPORT", label: m.prtr.sources.IMPORT },
        ],
        render: (x) => m.prtr.sources[x.source],
      },
      {
        key: "updatedAt",
        header: m.prtr.quantities.updatedAt,
        kind: "date",
        width: 150,
        className: "text-muted-foreground text-xs",
        render: (x) => new Date(x.updatedAt).toLocaleString(locale),
      },
    ],
    [t, m, locale],
  );
  const { state, setState } = useTableState(M_KEY, columns, M_STATE, "m");

  const loadRows = useCallback(async () => {
    const res = await fetch(
      `/api/prtr/entries/${entryId}/measured?${serializeTableState(state, M_STATE).toString()}`,
    ).catch(() => null);
    if (!res?.ok) {
      if (res) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
      }
      return;
    }
    setData((await res.json()) as ListResponse<PrtrMeasuredDto>);
  }, [entryId, state, m]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const changed = async () => {
    await Promise.all([loadRows(), onChanged()]);
  };

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
              ? { handledKg: form.handledKg, measuredKg: form.measuredKg }
              : {
                  substanceCode: form.substanceCode,
                  handledKg: form.handledKg || null,
                  measuredKg: form.measuredKg,
                },
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
      setForm(emptyForm);
      await changed();
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
    await changed();
  }

  const casLabel = (s: PrtrSubstanceCandidateDto) => s.casNumber ?? "";

  return (
    <div className="space-y-3">
      <div className="flex flex-row items-center justify-between gap-3">
        <p className="text-sm font-medium">{t.title}</p>
        <FilePickButton label={m.prtr.import.button} disabled={locked} onPick={setImporting} />
      </div>
      <div className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {open && form.id === "" && (
          <div className="border-border bg-muted/30 space-y-2 border p-3">
            <p className="text-sm font-medium">{t.find.title}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-36 space-y-1">
                <Label htmlFor="ms-find-code">{t.find.code}</Label>
                <Input
                  id="ms-find-code"
                  value={find.code}
                  autoComplete="off"
                  onChange={(e) => setFind({ ...find, code: e.target.value })}
                  className="h-8 font-mono"
                />
              </div>
              <div className="w-36 space-y-1">
                <Label htmlFor="ms-find-cas">{t.find.cas}</Label>
                <Input
                  id="ms-find-cas"
                  value={find.cas}
                  autoComplete="off"
                  onChange={(e) => setFind({ ...find, cas: e.target.value })}
                  className="h-8 font-mono"
                />
              </div>
              <div className="w-64 space-y-1">
                <Label htmlFor="ms-find-name">{t.find.name}</Label>
                <Input
                  id="ms-find-name"
                  value={find.name}
                  autoComplete="off"
                  onChange={(e) => setFind({ ...find, name: e.target.value })}
                  className="h-8"
                />
              </div>
              <span className="text-muted-foreground pb-2 text-xs">
                {finding ? t.find.searching : t.find.hint}
              </span>
            </div>
            {found !== null &&
              (found.length === 0 ? (
                <p className="text-muted-foreground text-xs">{t.find.none}</p>
              ) : (
                <ul className="divide-border bg-background max-h-56 divide-y overflow-y-auto border">
                  {found.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-2 py-1 text-sm">
                      <span className="w-28 shrink-0 font-mono text-xs">{s.code}</span>
                      <span className="w-28 shrink-0 font-mono text-xs">{casLabel(s)}</span>
                      <span className="min-w-0 flex-1 truncate">{labelOf(s)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        aria-label={`${t.find.pick} ${s.code}`}
                        onClick={() => pickSubstance(s)}
                      >
                        {t.find.pick}
                      </Button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}
        {open && (
          <div className="border-border bg-muted/30 flex flex-wrap items-end gap-3 border p-3">
            <div className="w-40 space-y-1">
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
            {/* 物質名と第一種指定化学物質は読むだけ。コードを入れると自動で入る */}
            {form.id === "" && (
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor="ms-resolved">{t.resolved}</Label>
                <Input
                  id="ms-resolved"
                  value={resolved ?? ""}
                  readOnly
                  tabIndex={-1}
                  className="bg-muted/50 h-8"
                />
                {resolved === "" && (
                  <p className="text-destructive text-xs">
                    {t.notPrtrSubstance(form.substanceCode.trim())}
                  </p>
                )}
              </div>
            )}
            <div className="w-36 space-y-1">
              <Label htmlFor="ms-handled">{t.handledKg}</Label>
              <Input
                ref={handledRef}
                id="ms-handled"
                inputMode="decimal"
                value={form.handledKg}
                onChange={(e) => setForm({ ...form, handledKg: e.target.value })}
                aria-invalid={Boolean(firstError(fieldErrors, "handledKg"))}
                className="h-8 font-mono"
              />
              <FieldError message={firstError(fieldErrors, "handledKg")} />
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
          create={
            !open && !locked
              ? {
                  label: t.add,
                  onClick: () => {
                    setForm(emptyForm);
                    setFind({ code: "", cas: "", name: "" });
                    setFound(null);
                    setResolved(null);
                    setOpen(true);
                  },
                }
              : undefined
          }
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(x) => x.id}
          total={data?.total ?? 0}
          state={state}
          defaultState={M_STATE}
          onStateChange={setState}
          emptyMessage={t.empty}
          selectable={!locked}
          onDeleteSelected={locked ? undefined : (sel) => void removeSelected(sel)}
          rowAction={
            locked
              ? undefined
              : {
                  onClick: (x) => {
                    setForm({
                      id: x.id,
                      substanceCode: x.substanceCode ?? "",
                      handledKg: x.handledKg ?? "",
                      measuredKg: x.measuredKg,
                    });
                    setOpen(true);
                  },
                }
          }
        />
      </div>
      {importing && (
        <PrtrImportDialog
          entryId={entryId}
          kind="measured"
          file={importing}
          onClose={(applied) => {
            setImporting(null);
            if (applied) void changed();
          }}
        />
      )}
    </div>
  );
}
