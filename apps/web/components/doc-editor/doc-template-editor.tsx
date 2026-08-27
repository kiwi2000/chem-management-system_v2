"use client";

import type { DocumentContent } from "@chem/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BlockList } from "@/components/doc-editor/block-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import type { ApiError, DocumentTemplateDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";

const SELECT = "border-input h-8 rounded-none border bg-transparent px-2 text-sm";

/**
 * テンプレートの中身（ブロックの並び）を編集する画面。
 *
 * **保存は押したときだけ。**打つたびに送ると、
 * 書きかけの状態が保存され、離れたときに何が残るのか読めなくなる。
 * 離れる前に注意を出すのは、保存していない変えぶんがあるときだけ。
 */
export function DocTemplateEditor({ id }: { id: string }) {
  const { m } = useI18n();
  const { can } = useMe();
  const editable = can("ADMIN");

  const [template, setTemplate] = useState<DocumentTemplateDto | null>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/doc-templates/${id}`);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      return;
    }
    const body = (await res.json()) as DocumentTemplateDto;
    setTemplate(body);
    setContent(body.content);
    setDirty(false);
  }, [id, m]);

  useEffect(() => {
    void load();
  }, [load]);

  /* 保存していない変えぶんがあるまま閉じられそうなときは、一度止める */
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  function edit(next: DocumentContent) {
    setContent(next);
    setDirty(true);
  }

  async function save() {
    if (!content) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      const body = (await res.json()) as DocumentTemplateDto;
      setTemplate(body);
      setContent(body.content);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  if (!template || !content) {
    return (
      <div className={PAGE_SHELL_STACKED}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-sm">{m.common.loading}</p>
        )}
      </div>
    );
  }

  return (
    <div className={PAGE_SHELL_STACKED}>
      {/* 一覧へ戻る小さなリンク。ほかの画面と同じ形 */}
      <Link href="/doc-templates" className="text-muted-foreground text-xs underline">
        {m.docTemplates.title}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {template.code} {template.nameJa}
        </h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            {m.docEditor.orientation}
            <select
              className={SELECT}
              disabled={!editable}
              value={content.orientation}
              onChange={(e) =>
                edit({ ...content, orientation: e.target.value as "portrait" | "landscape" })
              }
            >
              <option value="portrait">{m.docEditor.orientations.portrait}</option>
              <option value="landscape">{m.docEditor.orientations.landscape}</option>
            </select>
          </label>
          {editable && (
            <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? m.common.saving : m.common.save}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {template.contentBroken && (
        <Alert>
          <AlertDescription>{m.docTemplates.contentBroken}</AlertDescription>
        </Alert>
      )}

      {template.unknownFields.length > 0 && (
        <Alert>
          <AlertDescription>
            {m.docTemplates.unknownFields(template.unknownFields.length)}
            <span className="block font-mono text-xs">{template.unknownFields.join(" ")}</span>
          </AlertDescription>
        </Alert>
      )}

      <BlockList
        blocks={content.blocks}
        target={template.target}
        onChange={(blocks) => edit({ ...content, blocks })}
      />
    </div>
  );
}
