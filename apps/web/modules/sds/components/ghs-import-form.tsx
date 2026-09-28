"use client";

import type { Locale } from "@chem/shared";
import { useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import type { ApiError } from "@/lib/types";
import { sdsMessages } from "../messages";

interface Summary {
  applied: boolean;
  parsed: number;
  added: number;
  changed: number;
  unchanged: number;
  disappeared: number;
  issues: number;
  samples: { kind: string; key: string; name: string }[];
  issueSamples: string[];
  /** 結び付きの取り込み（LOLI）だけが返す */
  links?: { inSource: number; skipped: number; unknown: number };
}

/**
 * GHS 分類データの取り込み。先に「下見」で差分の件数を見せ、「取り込む」で反映する。
 * ファイルは毎回送り直す（サーバーに一時保存しない。PRTR の取り込みと同じ）
 */
export function GhsImportForm({
  locale,
  sources,
  onApplied,
}: {
  locale: Locale;
  sources: { code: string; name: string }[];
  onApplied?: () => void;
}) {
  const t = sdsMessages(locale).ghs.import;
  const [sourceCode, setSourceCode] = useState(sources[0]?.code ?? "NITE");
  const [label, setLabel] = useState("");
  const [publishedOn, setPublishedOn] = useState("");
  const mainRef = useRef<HTMLInputElement>(null);
  const rationaleRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Summary | null>(null);

  async function send(step: "preview" | "apply") {
    setError(null);
    const main = mainRef.current?.files?.[0];
    if (!main) return setError(t.needFile);
    if (!label.trim()) return setError(t.needLabel);
    if (!publishedOn) return setError(t.needDate);
    const form = new FormData();
    form.append("sourceCode", sourceCode);
    form.append("label", label);
    form.append("publishedOn", publishedOn);
    form.append("step", step);
    form.append("file", main);
    const rationale = rationaleRef.current?.files?.[0];
    if (rationale) form.append("rationale", rationale);
    setBusy(step);
    try {
      const res = await fetch("/api/modules/sds/ghs/import", { method: "POST", body: form });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as Summary;
      setResult(body);
      if (body.applied) onApplied?.();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {sourceCode === "NITE" ? t.hint : sourceCode === "LOLI" ? t.hintLoli : t.hintEu}
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="ghs-source">{t.source}</Label>
          <select
            id="ghs-source"
            value={sourceCode}
            onChange={(e) => setSourceCode(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-none border px-2 text-sm"
          >
            {sources.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ghs-label">{t.label}</Label>
          <Input
            id="ghs-label"
            value={label}
            maxLength={120}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ghs-date">{t.publishedOn}</Label>
          <Input
            id="ghs-date"
            type="date"
            value={publishedOn}
            onChange={(e) => setPublishedOn(e.target.value)}
          />
        </div>
        <div />
        <div className="space-y-1">
          <Label htmlFor="ghs-main">{sourceCode === "LOLI" ? t.linkFile : t.mainFile}</Label>
          <Input
            id="ghs-main"
            ref={mainRef}
            type="file"
            accept={sourceCode === "LOLI" ? ".tsv,.txt" : ".xlsx"}
          />
        </div>
        <div className="space-y-1" hidden={sourceCode !== "NITE"}>
          <Label htmlFor="ghs-rationale">
            {t.rationaleFile} <span className="text-muted-foreground">({t.optional})</span>
          </Label>
          <Input id="ghs-rationale" ref={rationaleRef} type="file" accept=".xlsx" />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void send("preview")}
        >
          {busy === "preview" ? t.previewing : t.preview}
        </Button>
        <Button
          type="button"
          disabled={busy !== null || !result || result.applied}
          onClick={() => void send("apply")}
        >
          {busy === "apply" ? t.applying : t.apply}
        </Button>
      </div>
      {result && (
        <div className="space-y-2 text-sm">
          <p className={result.applied ? "font-medium" : undefined}>
            {result.applied ? t.applied(label) + " " : ""}
            {result.links
              ? t.linkResult(
                  result.parsed,
                  result.added,
                  result.unchanged,
                  result.disappeared,
                  result.links.inSource,
                  result.links.skipped,
                  result.links.unknown,
                )
              : t.previewResult(
                  result.parsed,
                  result.added,
                  result.changed,
                  result.unchanged,
                  result.disappeared,
                  result.issues,
                )}
          </p>
          {result.samples.length > 0 && (
            <div>
              <p className="text-muted-foreground text-xs">{t.sampleTitle}</p>
              <ul className="list-disc pl-5">
                {result.samples.map((s, i) => (
                  <li key={i}>
                    [{s.kind}] {s.key} {s.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.issueSamples.length > 0 && (
            <div>
              <p className="text-muted-foreground text-xs">{t.issuesTitle}</p>
              <ul className="list-disc pl-5">
                {result.issueSamples.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
