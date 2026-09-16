"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, DocumentTemplateDto } from "@/lib/types";

/**
 * テンプレートを複製するときの窓。名前を聞いて、写しを作る。
 *
 * **名前は「元の名前 のコピー」で埋めておく。**そのまま押しても元と見分けがつく。
 * コードは空なら「元のコード-2」のように自動で付く（入れれば、そのコードで作る）。
 * できたら写しの編集画面へ移る（呼ぶ側が onCopied で移す）。
 */
export function CopyTemplateDialog({
  template,
  open,
  onOpenChange,
  onCopied,
}: {
  template: DocumentTemplateDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopied: (copy: DocumentTemplateDto) => void;
}) {
  const { m } = useI18n();
  const [nameJa, setNameJa] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開くたびに、元の名前から入れ直す（前に開いたときの打ちかけを残さない）
  useEffect(() => {
    if (!open) return;
    setNameJa(m.docTemplates.copyDefaultName(template.nameJa));
    setCode("");
    setError(null);
  }, [open, template.nameJa, m]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameJa.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/doc-templates/${template.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameJa: nameJa.trim(), code: code.trim() || null }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      onCopied((await res.json()) as DocumentTemplateDto);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="bg-popover text-popover-foreground ring-foreground/10 fixed top-1/2 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 shadow-lg ring-1 outline-none">
          <Dialog.Title className="text-base font-semibold">
            {m.docTemplates.copyTitle}
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-1 text-xs">
            {m.docTemplates.copyHint}
          </Dialog.Description>
          <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
            <div className="flex flex-col gap-1">
              <Label htmlFor="copy-name">{m.docTemplates.nameJa}</Label>
              <Input
                id="copy-name"
                value={nameJa}
                maxLength={200}
                required
                autoFocus
                onChange={(e) => setNameJa(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="copy-code">{m.docTemplates.code}</Label>
              <Input
                id="copy-code"
                value={code}
                maxLength={50}
                placeholder={m.docTemplates.copyCodePlaceholder(template.code)}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {m.common.cancel}
              </Button>
              <Button type="submit" disabled={busy || !nameJa.trim()}>
                {busy ? m.common.saving : m.docTemplates.copy}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
