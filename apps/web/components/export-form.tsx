"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";

type Kind = "REGULATION_LIST" | "PRODUCTS" | "SUBSTANCES" | "DATA_SET";
const KINDS: Kind[] = ["REGULATION_LIST", "PRODUCTS", "SUBSTANCES", "DATA_SET"];

export interface ExportOption {
  code: string;
  label: string;
}

/**
 * エクスポート（決定 0011）。書き出すものを選んでダウンロードする。
 * 選択肢（法律・データソース）はサーバー側の画面から受け取る（権限の都合で API を叩かない）
 */
export function ExportForm({ laws, sources }: { laws: ExportOption[]; sources: ExportOption[] }) {
  const { m } = useI18n();
  const [kind, setKind] = useState<Kind>("REGULATION_LIST");
  const [law, setLaw] = useState("");
  const [source, setSource] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const params = new URLSearchParams({ kind });
  if (kind === "REGULATION_LIST") {
    if (law) params.set("law", law);
    if (source) params.set("source", source);
  }
  if (kind === "DATA_SET" && picked.length > 0) params.set("sources", picked.join(","));
  const href = `/api/export?${params.toString()}`;

  const select = "border-input bg-background block h-8 rounded-none border px-2 text-sm";

  return (
    <div className={PAGE_SHELL_STACKED}>
      <Breadcrumbs items={[{ label: m.nav.importExport }, { label: m.nav.dataExport }]} />
      <h1 className="text-xl font-semibold">{m.importExport.exportTitle}</h1>
      <p className="text-muted-foreground max-w-3xl text-sm leading-relaxed">
        {m.importExport.exportLead}
      </p>

      <div className="border-border bg-muted/30 max-w-3xl space-y-4 border p-4 text-sm">
        <fieldset className="space-y-2">
          <legend className="font-medium">{m.importExport.exportKind}</legend>
          {KINDS.map((k) => (
            <label key={k} className="flex items-start gap-2">
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
                className="mt-1"
              />
              <span>
                <span>{m.importExport.exportKinds[k]}</span>
                <span className="text-muted-foreground block text-xs leading-relaxed">
                  {m.importExport.exportHints[k]}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        {kind === "REGULATION_LIST" && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="text-muted-foreground block text-xs">
                {m.importExport.exportLaw}
              </span>
              <select
                value={law}
                onChange={(e) => setLaw(e.target.value)}
                className={`${select} w-72`}
              >
                <option value="">{m.importExport.exportAll}</option>
                {laws.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code} {l.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground block text-xs">
                {m.importExport.exportSource}
              </span>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className={`${select} w-48`}
              >
                <option value="">{m.importExport.exportAll}</option>
                {sources.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {kind === "DATA_SET" && (
          <div className="space-y-1">
            <span className="text-muted-foreground block text-xs">
              {m.importExport.exportSources}
            </span>
            <div className="flex flex-wrap gap-3">
              {sources.map((s) => (
                <label key={s.code} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={picked.includes(s.code)}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked ? [...picked, s.code] : picked.filter((c) => c !== s.code),
                      )
                    }
                  />
                  {s.code}
                </label>
              ))}
            </div>
            <span className="text-muted-foreground block text-xs">
              {picked.length === 0 ? m.importExport.exportAll : ""}
            </span>
          </div>
        )}

        <div>
          {/* download 属性は同じオリジンなので効く。サーバーがファイル名を付ける */}
          <Button render={<a href={href} download />}>
            <Download className="size-4" />
            {m.importExport.download}
          </Button>
        </div>
      </div>
    </div>
  );
}
