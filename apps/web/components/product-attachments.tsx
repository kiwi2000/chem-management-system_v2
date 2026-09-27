"use client";

import { ATTACHMENT_KINDS, attachmentAccept, type AttachmentKind } from "@chem/shared";
import { Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { EditButton } from "@/components/edit-button";
import { EditingBadge } from "@/components/editing-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, ProductAttachmentDto } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 罫線はセルが自分の右と下に引く（ほかの小さな表と同じ） */
const CELL = "border-border border-r border-b last:border-r-0";

/** 行ごとの書きかけ（種類・備考・組成を見られる人だけ） */
type Draft = Pick<ProductAttachmentDto, "kind" | "note" | "compositionOnly">;

/** 大きさを読みやすく（1,234 KB / 12.3 MB） */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
}

/**
 * 製品・原材料の添付ファイル（2026-09-27 指示）。法規制判定の下、備考の上に置く。
 *
 * ほかのカードと同じく、まず読み取り専用で見せ「編集」で書き換え可にする。
 * **追加と削除はその場で保存する**（ファイルは大きいので、書きかけで抱えない）。
 * 種類・備考・「組成を見られる人だけ」は書きかけにして「保存」でまとめて送る
 */
export function ProductAttachments({
  productId,
  canEdit,
  canViewComposition,
  maxMb,
  allowMacros,
}: {
  productId: string;
  /** システム設定の上限（MB）とマクロの扱い。案内の文と、ファイル選びの窓の絞り込みに使う */
  maxMb: number;
  allowMacros: boolean;
  /** 製品を編集できる人 */
  canEdit: boolean;
  /** 組成を見られる人。「組成を見られる人だけ」の欄を出すかどうか */
  canViewComposition: boolean;
}) {
  const { m, locale } = useI18n();
  const ask = useConfirm();
  const t = m.attachments;
  const inputRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<ProductAttachmentDto[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);

  const base = `/api/products/${productId}/attachments`;

  const load = useCallback(async () => {
    const res = await fetch(base);
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      setError(m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: ProductAttachmentDto[] }).items);
  }, [base, m]);

  useEffect(() => {
    void load();
  }, [load]);

  const draftOf = (a: ProductAttachmentDto): Draft =>
    drafts[a.id] ?? { kind: a.kind, note: a.note, compositionOnly: a.compositionOnly };
  const setDraft = (a: ProductAttachmentDto, patch: Partial<Draft>) =>
    setDrafts((d) => ({ ...d, [a.id]: { ...draftOf(a), ...patch } }));

  async function failMessage(res: Response): Promise<string> {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    return body?.error.message ?? m.errors.saveFailed(res.status);
  }

  async function upload(files: FileList) {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    setRejected([]);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch(base, { method: "POST", body: form });
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as {
        items?: ProductAttachmentDto[];
        rejected?: { name: string; reason: string }[];
        error?: { message: string };
      } | null;
      if (body?.items) setItems(body.items);
      if (body?.rejected) setRejected(body.rejected.map((r) => t.rejected(r.name, r.reason)));
      if (!res.ok && !body?.rejected?.length) {
        setError(body?.error?.message ?? m.errors.saveFailed(res.status));
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: ProductAttachmentDto) {
    if (!(await ask({ message: t.removeConfirm(a.fileName), destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${a.id}`, { method: "DELETE" });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        setError(await failMessage(res));
        return;
      }
      setItems((xs) => (xs ?? []).filter((x) => x.id !== a.id));
      setDrafts(({ [a.id]: _gone, ...rest }) => rest);
    } finally {
      setBusy(false);
    }
  }

  /** 書きかけを送る。変わった行だけ */
  async function save() {
    if (!items) return;
    setBusy(true);
    setError(null);
    try {
      const next = [...items];
      for (const [i, a] of items.entries()) {
        const d = drafts[a.id];
        if (!d) continue;
        const changed =
          d.kind !== a.kind ||
          (d.note ?? "") !== (a.note ?? "") ||
          d.compositionOnly !== a.compositionOnly;
        if (!changed) continue;
        const res = await fetch(`${base}/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: d.kind,
            note: d.note ?? null,
            ...(canViewComposition ? { compositionOnly: d.compositionOnly } : {}),
          }),
        });
        if (!res.ok) {
          if (redirectIfUnauthorized(res)) return;
          setError(await failMessage(res));
          setItems(next);
          return;
        }
        next[i] = (await res.json()) as ProductAttachmentDto;
      }
      setItems(next);
      setDrafts({});
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  function discard() {
    setDrafts({});
    setRejected([]);
    setError(null);
    setEditing(false);
  }

  const count = items?.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          {t.title}
          {count > 0 && (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{count}</span>
          )}
        </CardTitle>
        {canEdit &&
          (editing ? (
            <span className="flex flex-wrap items-center gap-2">
              <EditingBadge />
              <Button type="button" size="sm" variant="outline" onClick={discard}>
                {m.common.discard}
              </Button>
            </span>
          ) : (
            <EditButton onClick={() => setEditing(true)} />
          ))}
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {rejected.length > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              {rejected.map((r) => (
                <div key={r}>{r}</div>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {items === null ? (
          <p className="text-muted-foreground text-sm">{m.common.loading}</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <div className="bg-background overflow-x-auto rounded-md border">
            <Table className="border-separate border-spacing-0">
              <TableHeader className="bg-table-head text-table-head-foreground [&_th]:text-inherit">
                <TableRow>
                  <TableHead className={CELL}>{t.fileName}</TableHead>
                  <TableHead className={cn(CELL, "w-32")}>{t.kind}</TableHead>
                  <TableHead className={cn(CELL, "min-w-56")}>{t.note}</TableHead>
                  {canViewComposition && (
                    <TableHead className={cn(CELL, "w-28 text-center")}>
                      {t.compositionOnly}
                    </TableHead>
                  )}
                  <TableHead className={cn(CELL, "w-24 text-right")}>{t.size}</TableHead>
                  <TableHead className={cn(CELL, "w-32")}>{t.createdBy}</TableHead>
                  <TableHead className={cn(CELL, "w-40")}>{t.createdAt}</TableHead>
                  {editing && <TableHead className={cn(CELL, "w-12")} />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => {
                  const d = draftOf(a);
                  return (
                    <TableRow key={a.id}>
                      <TableCell className={cn(CELL, "break-all")}>
                        <a
                          href={`${base}/${a.id}/file`}
                          className="text-primary inline-flex items-start gap-1 underline-offset-2 hover:underline"
                          title={t.download}
                        >
                          <Paperclip className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          {a.fileName}
                        </a>
                      </TableCell>
                      <TableCell className={CELL}>
                        {editing ? (
                          <select
                            aria-label={t.kind}
                            value={d.kind}
                            onChange={(e) =>
                              setDraft(a, { kind: e.target.value as AttachmentKind })
                            }
                            className="border-input bg-background h-8 w-full rounded-none border px-1 text-sm"
                          >
                            {ATTACHMENT_KINDS.map((k) => (
                              <option key={k} value={k}>
                                {t.kinds[k]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          t.kinds[a.kind]
                        )}
                      </TableCell>
                      <TableCell className={cn(CELL, "whitespace-pre-wrap")}>
                        {editing ? (
                          <Input
                            aria-label={t.note}
                            maxLength={1000}
                            value={d.note ?? ""}
                            onChange={(e) => setDraft(a, { note: e.target.value })}
                            className="h-8"
                          />
                        ) : (
                          a.note
                        )}
                      </TableCell>
                      {canViewComposition && (
                        <TableCell className={cn(CELL, "text-center")}>
                          <input
                            type="checkbox"
                            aria-label={t.compositionOnly}
                            title={t.compositionOnlyHint}
                            checked={d.compositionOnly}
                            disabled={!editing}
                            onChange={(e) => setDraft(a, { compositionOnly: e.target.checked })}
                          />
                        </TableCell>
                      )}
                      <TableCell className={cn(CELL, "text-right tabular-nums")}>
                        {formatSize(a.size)}
                      </TableCell>
                      <TableCell className={CELL}>{a.createdByName ?? "—"}</TableCell>
                      <TableCell className={cn(CELL, "tabular-nums")}>
                        {new Date(a.createdAt).toLocaleString(locale === "en" ? "en-US" : "ja-JP")}
                      </TableCell>
                      {editing && (
                        <TableCell className={cn(CELL, "text-center")}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            title={t.remove}
                            aria-label={t.remove}
                            disabled={busy}
                            onClick={() => void remove(a)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {editing && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={attachmentAccept(allowMacros)}
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files) void upload(files).finally(() => (e.target.value = ""));
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                <Paperclip className="mr-1 size-3.5" />
                {busy ? t.uploading : t.add}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{t.hint(maxMb, allowMacros)}</p>
            {canViewComposition && (
              <p className="text-muted-foreground text-xs">{t.compositionOnlyHint}</p>
            )}
            <div className="flex gap-2">
              <Button type="button" disabled={busy} onClick={() => void save()}>
                {busy ? m.common.saving : m.common.save}
              </Button>
              <Button type="button" variant="outline" onClick={discard}>
                {m.common.discard}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
