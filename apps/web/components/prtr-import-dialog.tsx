"use client";

import {
  guessColumn,
  PRTR_IMPORT_FIELDS,
  type PrtrImportKind,
  type PrtrImportMode,
} from "@chem/shared";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, PrtrImportInspectDto, PrtrImportResultDto } from "@/lib/types";

/**
 * 届出データの取り込み（S22）。
 *
 * ファイルは「ファイル」ボタンで OS の選択画面から選ばれて渡ってくる（この窓では選ばない）。
 * 1. 1 行目を見出しとして読み、どの列を何に使うかを選ぶ（見出しが項目名と同じ列は最初から割り当てる）
 * 2. プレビュー（何も書かない）→ 重ね方／上書きの答え → 取り込む
 *
 * ファイルはサーバーに置かず、毎回送り直す
 */
export function PrtrImportDialog({
  entryId,
  kind,
  file,
  shippedRequired = false,
  onClose,
}: {
  entryId: string;
  /** どの表の「ファイル」から開いたか。**いま選ばれている方法に合わせて決まり、窓の中では変えない** */
  kind: PrtrImportKind;
  /** 選ばれたファイル */
  file: File;
  /** 出荷数量が要る方法か（物質収支・排出係数）。要るなら列が無いと進めない */
  shippedRequired?: boolean;
  /** applied が true なら表を読み直す */
  onClose: (applied: boolean) => void;
}) {
  const { m } = useI18n();
  const t = m.prtr.import;
  // 出荷数量は方法しだいで必須になる。窓で止めないと、プレビューで全行「出荷数量が要ります」になる
  const fields = PRTR_IMPORT_FIELDS[kind].map((f) =>
    f.key === "shippedKg" && shippedRequired ? { ...f, required: true } : f,
  );
  const [inspected, setInspected] = useState<PrtrImportInspectDto | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [mode, setMode] = useState<PrtrImportMode>("upsert");
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<PrtrImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  async function send(step: "inspect" | "run", input?: object) {
    const form = new FormData();
    form.append("file", file);
    form.append("step", step);
    if (input) form.append("input", JSON.stringify(input));
    const res = await fetch(`/api/prtr/entries/${entryId}/import`, { method: "POST", body: form });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return null;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.saveFailed(res.status));
      return null;
    }
    return res.json();
  }

  async function inspect(f: File) {
    setError(null);
    setResult(null);
    setInspected(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      form.append("step", "inspect");
      const res = await fetch(`/api/prtr/entries/${entryId}/import`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const body = (await res.json()) as PrtrImportInspectDto;
      setInspected(body);
      applyGuess(kind, body.headers);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void inspect(file);
    // ファイルが変わることは無い（選び直すときは窓ごと開き直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  /** 見出しが項目名と同じ列は最初から割り当てる */
  function applyGuess(k: PrtrImportKind, headers: string[]) {
    const guess: Record<string, number | null> = {};
    for (const fd of PRTR_IMPORT_FIELDS[k]) guess[fd.key] = guessColumn(headers, fd.aliases);
    setMapping(guess);
  }

  const missing = fields.filter((f) => f.required && mapping[f.key] == null);
  const cleanMapping = () =>
    Object.fromEntries(Object.entries(mapping).filter((e): e is [string, number] => e[1] != null));

  async function run(dryRun: boolean) {
    setError(null);
    setBusy(true);
    try {
      const body = (await send("run", {
        kind,
        mapping: cleanMapping(),
        mode,
        overwrite,
        dryRun,
      })) as PrtrImportResultDto | null;
      if (!body) return;
      setResult(body);
      if (body.applied) setApplied(true);
    } finally {
      setBusy(false);
    }
  }

  /** 列に割り当て済みの項目。同じ列を 2 つの項目に使えない */
  const usedBy = (col: number, except: string) =>
    Object.entries(mapping).find(([k, v]) => v === col && k !== except)?.[0];

  // 畳める箱の中に描くと、箱の変形や切り抜きの影響を受けるので、画面の最上位に出す
  return createPortal(
    <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-6">
      <Card collapsible={false} className="max-h-[85vh] w-[52rem] overflow-auto">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>
              {t.title}
              <span className="text-muted-foreground ml-3 text-sm font-normal">
                {t.kinds[kind]}
              </span>
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">{file.name}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onClose(applied)}>
            {m.common.close}
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {inspected && (
            <section className="space-y-2">
              <p className="text-sm font-medium">{t.step2}</p>
              <p className="text-muted-foreground text-xs">{t.headersHint}</p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-primary text-primary-foreground">
                    <th className="px-2 py-1 text-left">{t.assign}</th>
                    <th className="px-2 py-1 text-left">{t.column}</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.key} className="border-border border-b">
                      <td className="w-64 px-2 py-1">
                        {t.fields[f.key as keyof typeof t.fields]}
                        {f.required && (
                          <span className="text-muted-foreground ml-1 text-xs">
                            {t.requiredMark}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <select
                          aria-label={t.fields[f.key as keyof typeof t.fields]}
                          value={mapping[f.key] ?? ""}
                          disabled={applied}
                          onChange={(e) => {
                            setResult(null);
                            setMapping({
                              ...mapping,
                              [f.key]: e.target.value === "" ? null : Number(e.target.value),
                            });
                          }}
                          className="border-input bg-background h-8 w-full max-w-md rounded-none border px-2 text-sm"
                        >
                          <option value="">{t.unused}</option>
                          {inspected.headers.map((h, i) => (
                            <option key={i} value={i} disabled={usedBy(i, f.key) !== undefined}>
                              {i + 1}: {h || "—"}
                              {inspected.sample[0]?.[i] ? `（${inspected.sample[0][i]}）` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-muted-foreground text-xs">{t.rows(inspected.rowCount)}</p>
            </section>
          )}

          {inspected && (
            <section className="space-y-3">
              <p className="text-sm font-medium">{t.step3}</p>
              {kind === "quantities" && (
                <div className="space-y-1 text-sm">
                  <p className="font-medium">{t.mode}</p>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="prtr-mode"
                      checked={mode === "upsert"}
                      disabled={applied}
                      onChange={() => {
                        setMode("upsert");
                        setResult(null);
                      }}
                    />
                    {t.modeUpsert}
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="prtr-mode"
                      checked={mode === "replace"}
                      disabled={applied}
                      onChange={() => {
                        setMode("replace");
                        setResult(null);
                      }}
                    />
                    {t.modeReplace}
                  </label>
                </div>
              )}
              {missing.length > 0 && (
                <p className="text-destructive text-xs">
                  {t.required(t.fields[missing[0]!.key as keyof typeof t.fields])}
                  <span className="text-muted-foreground ml-2">{t.expected[kind]}</span>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || applied || missing.length > 0}
                  onClick={() => void run(true)}
                >
                  {t.preview}
                </Button>
                <span className="text-muted-foreground text-xs">{t.previewHint}</span>
              </div>

              {result && (
                <div className="border-border bg-muted/30 space-y-2 border p-3 text-sm">
                  <p>
                    {t.readable(result.readable)}・{t.unreadable(result.unreadable)}
                    {kind === "quantities" && result.nameMismatch > 0 && (
                      <span className="text-muted-foreground ml-2">
                        {t.nameMismatch(result.nameMismatch)}
                      </span>
                    )}
                  </p>
                  <p>
                    {t.willAdd(result.willAdd)}・{t.willUpdate(result.willUpdate)}
                    {result.willRemove > 0 && (
                      <span className="ml-1">・{t.willRemove(result.willRemove)}</span>
                    )}
                  </p>
                  {result.errors.length > 0 && (
                    <ul className="text-destructive list-disc space-y-0.5 pl-5 text-xs">
                      {result.errors.map((e, i) => (
                        <li key={i}>
                          {t.line(e.line)}: {e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* 実測値: 既に値がある物質があれば、OK の答えが無いかぎり取り込まない */}
                  {kind === "measured" && result.conflicts > 0 && !applied && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={overwrite}
                        onChange={(e) => setOverwrite(e.target.checked)}
                      />
                      {t.overwriteAsk(result.conflicts)} {t.overwriteYes}
                    </label>
                  )}
                  {applied ? (
                    <p className="font-medium">{t.done(result.willAdd + result.willUpdate)}</p>
                  ) : (
                    <Button
                      size="sm"
                      disabled={
                        busy ||
                        result.readable === 0 ||
                        (kind === "measured" && result.conflicts > 0 && !overwrite)
                      }
                      onClick={() => void run(false)}
                    >
                      {t.apply}
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
        </CardContent>
      </Card>
    </div>,
    document.body,
  );
}
