"use client";

import {
  FIELD_LABELS_JA,
  emptyTableState,
  serializeTableState,
  type TableState,
} from "@chem/shared";
import { Check, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { useConfirm } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table/data-table";
import type { TableColumn } from "@/components/data-table/types";
import { fmtWhen, statusVariant } from "@/components/import-screen";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ImportAction, ImportJobDto, ImportRowDto } from "@/lib/import/dto";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import type { ApiError, ListResponse } from "@/lib/types";
import { useTableState } from "@/lib/use-table-state";

const DEFAULT_STATE: TableState = emptyTableState([{ column: "seq", direction: "asc" }]);
const ACTIONS: ImportAction[] = ["ADD", "UPDATE", "CONFLICT", "UNCHANGED", "ERROR"];
const APPLIABLE = new Set<ImportAction>(["ADD", "UPDATE", "CONFLICT"]);

/** 動きの色。追加・更新は普通、要確認は目立たせ、読めないは赤 */
function actionVariant(a: ImportAction): "default" | "secondary" | "destructive" | "outline" {
  if (a === "ERROR") return "destructive";
  if (a === "CONFLICT") return "default";
  if (a === "UNCHANGED") return "outline";
  return "secondary";
}

/** 値を 1 行で。空は「（空）」 */
const THRESHOLD_FIELDS = new Set(["thresholdLower", "lowerBound", "thresholdUpper", "upperBound"]);

function show(v: unknown, empty: string): string {
  if (v === null || v === undefined || v === "") return empty;
  if (Array.isArray(v)) return v.map((x) => show(x, empty)).join("; ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * 取り込み 1 件の画面（決定 0011）。状態で出すものが変わる:
 *   UPLOADED … ファイルの概要と「インポート」
 *   LOADING / APPLYING … 進み具合（数秒おきに取り直す）
 *   STAGED … 一時領域の表。行ごとの「反映する」を直して「反映」
 *   DONE … 反映した件数と、判定し直しの案内
 *   FAILED … 理由と「読み直す」
 */
export function ImportJobScreen({ id }: { id: string }) {
  const { m, locale } = useI18n();
  const router = useRouter();
  const ask = useConfirm();
  const [job, setJob] = useState<ImportJobDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const loadJob = useCallback(async () => {
    const res = await fetch(`/api/import/${id}`).catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      return;
    }
    setJob((await res.json()) as ImportJobDto);
  }, [id, m]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  const busy = job?.running || job?.status === "LOADING" || job?.status === "APPLYING";
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => void loadJob(), 2000);
    return () => window.clearInterval(t);
  }, [busy, loadJob]);

  // ---- 一時領域の表 ----
  const columns = useMemo<TableColumn<ImportRowDto>[]>(
    () => [
      {
        key: "seq",
        header: m.importExport.seq,
        kind: "number",
        width: 64,
        filterable: false,
        className: "text-right tabular-nums text-xs",
        render: (r) => r.seq,
      },
      {
        key: "apply",
        header: m.importExport.apply,
        kind: "enum",
        width: 84,
        sortable: false,
        filterable: false,
        className: "text-center",
        render: (r) =>
          APPLIABLE.has(r.action) ? (
            <input
              type="checkbox"
              aria-label={m.importExport.apply}
              checked={r.apply}
              disabled={job?.status !== "STAGED" || busy}
              onChange={(e) => void setApply([r.id], e.target.checked)}
            />
          ) : null,
      },
      {
        key: "kind",
        header: m.importExport.rowKind,
        kind: "enum",
        width: 136,
        options: Object.entries(m.importExport.rowKinds).map(([value, label]) => ({
          value,
          label,
        })),
        render: (r) => m.importExport.rowKinds[r.kind] ?? r.kind,
      },
      {
        key: "action",
        header: m.importExport.action,
        kind: "enum",
        width: 104,
        options: ACTIONS.map((a) => ({ value: a, label: m.importExport.actions[a] })),
        render: (r) => (
          <Badge variant={actionVariant(r.action)}>{m.importExport.actions[r.action]}</Badge>
        ),
      },
      {
        key: "keyPath",
        header: m.importExport.keyPath,
        kind: "text",
        width: 260,
        className: "font-mono text-xs",
        render: (r) => r.keyPath,
      },
      {
        key: "label",
        header: m.importExport.label,
        kind: "text",
        width: 240,
        render: (r) => r.label,
      },
      {
        key: "diff",
        header: m.importExport.diff,
        kind: "text",
        width: 360,
        sortable: false,
        filterable: false,
        multiline: true,
        clampLines: 4,
        className: "text-xs",
        render: (r) =>
          r.diff
            ? Object.entries(r.diff).map(([field, d]) => {
                // 法文物質名の閾値は、空が「区分の既定値に従う」の意味
                const empty =
                  r.kind === "substance" && THRESHOLD_FIELDS.has(field)
                    ? m.importExport.categoryDefault
                    : m.importExport.empty;
                return (
                  <div key={field}>
                    <span className="text-muted-foreground">
                      {(locale === "ja" ? FIELD_LABELS_JA[field] : undefined) ?? field}:
                    </span>{" "}
                    {show(d.current, empty)} {m.importExport.diffArrow} {show(d.next, empty)}
                  </div>
                );
              })
            : null,
      },
      {
        key: "message",
        header: m.importExport.message,
        kind: "text",
        width: 260,
        multiline: true,
        clampLines: 3,
        className: "text-xs",
        render: (r) => r.message ?? "",
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setApply は id にしか依らない
    [m, locale, job?.status, busy],
  );

  const { state, setState, ready } = useTableState(
    `chem.table.import-rows`,
    columns,
    DEFAULT_STATE,
  );
  const [rows, setRows] = useState<ListResponse<ImportRowDto> | null>(null);
  const query = useMemo(() => serializeTableState(state, DEFAULT_STATE).toString(), [state]);

  const loadRows = useCallback(async () => {
    const res = await fetch(
      `/api/import/${id}/rows?${query}${showUnchanged ? "&showUnchanged=1" : ""}`,
    );
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setRows({ items: [], total: 0, page: 1, pageSize: 50 });
      return;
    }
    setRows((await res.json()) as ListResponse<ImportRowDto>);
  }, [id, query, showUnchanged, m]);

  const hasRows = job?.status === "STAGED" || job?.status === "DONE" || job?.status === "APPLYING";
  useEffect(() => {
    if (ready && hasRows && !busy) void loadRows();
  }, [ready, hasRows, busy, loadRows]);

  async function setApply(ids: string[], apply: boolean) {
    const res = await fetch(`/api/import/${id}/rows`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, apply }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    // 表の該当行だけ書き換える（取り直すとページが飛ぶ）
    setRows((cur) =>
      cur
        ? { ...cur, items: cur.items.map((r) => (ids.includes(r.id) ? { ...r, apply } : r)) }
        : cur,
    );
    void loadJob();
  }

  /** いま絞っている種類・動きの全部に印を付ける／外す。絞っていなければ全行 */
  async function setApplyAll(apply: boolean) {
    const kindF = state.filters.kind;
    const actionF = state.filters.action;
    const all = {
      ...(kindF?.kind === "enum" && kindF.values.length === 1 ? { kind: kindF.values[0] } : {}),
      ...(actionF?.kind === "enum" &&
      actionF.values.length === 1 &&
      APPLIABLE.has(actionF.values[0] as ImportAction)
        ? { action: actionF.values[0] }
        : {}),
    };
    const res = await fetch(`/api/import/${id}/rows`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all, apply }),
    });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return;
    }
    void loadRows();
    void loadJob();
  }

  async function post(path: "stage" | "apply") {
    setError(null);
    setActing(true);
    try {
      const res = await fetch(`/api/import/${id}/${path}`, { method: "POST" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      await loadJob();
    } finally {
      setActing(false);
    }
  }

  async function onApply() {
    const n = toApplyCount;
    if (
      !(await ask({
        message: m.importExport.applyConfirm(n),
        confirmLabel: m.importExport.doApply,
      }))
    )
      return;
    await post("apply");
  }

  async function onDiscard() {
    if (
      !(await ask({
        message: m.importExport.discardConfirm,
        destructive: true,
        confirmLabel: m.importExport.discard,
      }))
    )
      return;
    setActing(true);
    try {
      const res = await fetch(`/api/import/${id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.deleteFailed);
        return;
      }
      router.push("/import-export/import");
    } finally {
      setActing(false);
    }
  }

  // ---- 件数のまとめ（種類 × 動き）。詳細 API が一時領域の行から数えたもの ----
  const counts = job?.counts ?? [];
  const kindsSeen = [...new Set(counts.map((c) => c.kind))];
  const countOf = (kind: string, action: ImportAction) =>
    counts.filter((c) => c.kind === kind && c.action === action).reduce((s, c) => s + c.count, 0);
  const toApplyCount = counts
    .filter((c) => c.apply && APPLIABLE.has(c.action))
    .reduce((s, c) => s + c.count, 0);
  const summary = job?.summary ?? null;

  return (
    <div className={PAGE_SHELL_STACKED}>
      <Breadcrumbs
        items={[
          { label: m.nav.importExport },
          { label: m.nav.dataImport, href: "/import-export/import" },
          { label: job?.fileName ?? "" },
        ]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{job?.fileName ?? m.common.loading}</h1>
        {job && (
          <Badge variant={statusVariant(job.status)}>{m.importExport.statuses[job.status]}</Badge>
        )}
        {job && (
          <span className="text-muted-foreground text-sm">{m.importExport.kinds[job.kind]}</span>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {job?.status === "FAILED" && job.error && (
        <Alert variant="destructive">
          <AlertDescription>{job.error}</AlertDescription>
        </Alert>
      )}

      {/* 概要。アップロード直後は種類と行数と列、読み取り後は種類×動きの件数 */}
      {job && (
        <div className="border-border bg-muted/30 max-w-4xl space-y-3 border p-4 text-sm">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <span className="text-muted-foreground">{m.importExport.detectedKind}</span>
            <span>{m.importExport.kinds[job.kind]}</span>
            <span className="text-muted-foreground">{m.importExport.detectedRows}</span>
            <span className="tabular-nums">{summary?.rows?.toLocaleString() ?? ""}</span>
            {summary?.header && summary.header.length > 0 && (
              <>
                <span className="text-muted-foreground">{m.importExport.detectedColumns}</span>
                <span className="break-all">
                  {summary.header.join(locale === "ja" ? "、" : ", ")}
                </span>
              </>
            )}
            <span className="text-muted-foreground">{m.importExport.createdBy}</span>
            <span>
              {job.createdByName ?? ""} {fmtWhen(job.createdAt, locale)}
            </span>
            {job.appliedAt && (
              <>
                <span className="text-muted-foreground">{m.importExport.appliedAt}</span>
                <span>
                  {job.appliedByName ?? ""} {fmtWhen(job.appliedAt, locale)}
                </span>
              </>
            )}
          </div>

          {busy && (
            <div className="space-y-1">
              <div className="bg-muted h-2 w-full max-w-md overflow-hidden">
                <div
                  className="bg-primary h-full transition-all"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {m.importExport.progress(job.progress)} {m.importExport.running}
              </p>
            </div>
          )}

          {kindsSeen.length > 0 && (
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="pr-4 text-left font-medium">{m.importExport.summaryCounts}</th>
                    {ACTIONS.map((a) => (
                      <th
                        key={a}
                        className="px-2 text-right font-medium"
                        title={m.importExport.actionHints[a]}
                      >
                        {m.importExport.actions[a]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kindsSeen.map((k) => (
                    <tr key={k}>
                      <td className="pr-4">{m.importExport.rowKinds[k] ?? k}</td>
                      {ACTIONS.map((a) => (
                        <td key={a} className="px-2 text-right tabular-nums">
                          {countOf(k, a) || ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {summary?.notes && summary.notes.length > 0 && (
            <div>
              <div className="text-muted-foreground text-xs">{m.importExport.notes}</div>
              <ul className="list-disc pl-5 text-xs">
                {summary.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {summary?.apply && (
            <p>
              {m.importExport.applied}:{" "}
              {m.importExport.appliedSummary(
                Object.values(summary.apply.applied).reduce((s, n) => s + n, 0),
                summary.apply.skipped,
                summary.apply.failed,
              )}
            </p>
          )}

          {/* 操作。状態に合うものだけ */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {(job.status === "UPLOADED" || job.status === "FAILED" || job.status === "STAGED") &&
              !busy && (
                <Button disabled={acting} onClick={() => void post("stage")}>
                  <Play className="size-4" />
                  {job.status === "UPLOADED" ? m.importExport.doImport : m.importExport.reread}
                </Button>
              )}
            {job.status === "STAGED" && !busy && (
              <Button disabled={acting || toApplyCount === 0} onClick={() => void onApply()}>
                <Check className="size-4" />
                {m.importExport.doApply}
                {toApplyCount > 0 ? ` (${toApplyCount.toLocaleString()})` : ""}
              </Button>
            )}
            {job.status !== "DONE" && job.status !== "DISCARDED" && !busy && (
              <Button variant="destructive" disabled={acting} onClick={() => void onDiscard()}>
                <Trash2 className="size-4" />
                {m.importExport.discard}
              </Button>
            )}
          </div>
          {job.status === "UPLOADED" && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {m.importExport.importHint}
            </p>
          )}
          {job.status === "STAGED" && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {m.importExport.applyHint}
            </p>
          )}
          {job.status === "DONE" && (
            <p className="text-xs leading-relaxed">
              {m.importExport.rejudgeReminder}{" "}
              <Link href="/admin/settings#rejudge" className="underline underline-offset-2">
                {m.importExport.rejudgeLink}
              </Link>
            </p>
          )}
        </div>
      )}

      {/* 一時領域の表 */}
      {hasRows && (
        <DataTable
          title={m.importExport.staged}
          storageKey="chem.table.import-rows"
          columns={columns}
          rows={rows?.items ?? null}
          rowKey={(r) => r.id}
          total={rows?.total ?? 0}
          state={state}
          defaultState={DEFAULT_STATE}
          onStateChange={setState}
          emptyMessage={m.importExport.noRows}
          pageSizeOptions={[25, 50, 100, 200]}
          headerActions={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={showUnchanged}
                  onChange={(e) => setShowUnchanged(e.target.checked)}
                />
                {m.importExport.showUnchanged}
              </label>
              {job?.status === "STAGED" && !busy && (
                <>
                  <Button size="sm" variant="outline" onClick={() => void setApplyAll(true)}>
                    {m.importExport.checkAll}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void setApplyAll(false)}>
                    {m.importExport.uncheckAll}
                  </Button>
                </>
              )}
            </div>
          }
        />
      )}
    </div>
  );
}
