"use client";

import { documentTags, type DocumentTarget, type DocumentTemplateKind } from "@chem/shared";
import { Download, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, DocumentTemplateDto } from "@/lib/types";

/**
 * Excel・Word の様式を預ける欄。
 *
 * **画面では中身を見せない。**Word・Excel で開いて確かめてもらう。
 * 代わりに、**使える札を写せる形で並べる**。札は打たせない（打ち間違いが空欄になるため）
 */
export function TemplateFilePanel({
  template,
  editable,
  orgItems,
  onChanged,
}: {
  template: DocumentTemplateDto;
  editable: boolean;
  orgItems: string[];
  onChanged: () => void;
}) {
  const { m, locale } = useI18n();
  const ask = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const kind = template.kind as Exclude<DocumentTemplateKind, "BLOCK">;
  const accept = kind === "XLSX" ? ".xlsx" : ".docx";
  const groups = documentTags(template.target as DocumentTarget, locale, orgItems);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-templates/${template.id}/file`, {
        method: "PUT",
        headers: { "x-file-name": encodeURIComponent(file.name) },
        body: file,
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    // 預けたファイルはその場で消える（保存で確定する類ではない）ので、消す前に聞く
    if (!(await ask({ message: m.docTemplates.fileRemoveConfirm, destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-templates/${template.id}/file`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        setError(m.errors.deleteFailed);
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">{m.docTemplates.file.lead}</p>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3 border p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{m.docTemplates.file.title}</span>
          <span className="text-sm">{template.fileName ?? m.docTemplates.file.none}</span>
          {template.fileName && (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/doc-templates/${template.id}/file`} />}
            >
              <Download className="size-4" />
              {m.docTemplates.file.download}
            </Button>
          )}
          {editable && (
            <>
              <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
                <Upload className="size-4" />
                {template.fileName ? m.docTemplates.file.replace : m.docTemplates.file.choose}
              </Button>
              {template.fileName && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove()}>
                  <Trash2 className="size-4" />
                  {m.docTemplates.file.remove}
                </Button>
              )}
            </>
          )}
          <input
            ref={input}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </div>

        {template.fileTags && template.fileTags.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {m.docTemplates.file.tagsInFile}
            <span className="text-foreground ml-2 font-mono">{template.fileTags.join(" ")}</span>
          </p>
        )}
      </div>

      {template.fileUnknown && template.fileUnknown.length > 0 && (
        <Alert>
          <AlertDescription>
            {m.docTemplates.file.unknownHint}
            <span className="block font-mono text-xs">
              {template.fileUnknown.map((k) => `{${k}}`).join(" ")}
            </span>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">{m.docTemplates.file.tags}</h2>
          <p className="text-muted-foreground text-xs">{m.docTemplates.file.tagsHint}</p>
        </div>
        {groups.map((g) => (
          <div key={g.group} className="space-y-1">
            <p className="text-muted-foreground text-xs">{g.group}</p>
            <div className="flex flex-wrap gap-1">
              {g.items.map((it) => (
                <button
                  key={it.tag}
                  type="button"
                  title={it.label}
                  className="border-input hover:bg-accent border px-2 py-1 text-left text-xs"
                  onClick={() => {
                    void navigator.clipboard?.writeText(it.tag);
                    setCopied(it.tag);
                  }}
                >
                  <span className="font-mono">{it.tag}</span>
                  <span className="text-muted-foreground ml-2">{it.label}</span>
                  {copied === it.tag && <span className="ml-2">✓</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-muted-foreground text-xs">{m.docTemplates.file.rowHint}</p>
      </div>
    </div>
  );
}
