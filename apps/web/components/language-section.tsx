"use client";

import { pickName } from "@chem/shared";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import type { ApiError, LanguageDto } from "@/lib/types";
import { cn } from "@/lib/utils";

const NEW_ID = "__new__";

interface Draft {
  code: string;
  nameJa: string;
  nameEn: string;
  displayOrder: number;
}
const EMPTY: Draft = { code: "", nameJa: "", nameEn: "", displayOrder: 0 };

const CELL = "border-r px-2 py-1 last:border-r-0";
const CELL_INPUT = "h-7 w-full text-sm";

/**
 * 言語。法規制の「原文の言語」で選ぶ値をここで登録する。
 *
 * 地域・国と同じマスタなので、同じく**表の行のまま**書き換える。
 * 法規制で使われている言語は、コードを変えることも消すこともできない
 * （名称は各表に文字列で入っているため）。
 */
export function LanguageSection() {
  const { m, locale } = useI18n();

  const [items, setItems] = useState<LanguageDto[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [original, setOriginal] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/languages");
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.loadFailed(res.status));
      setItems([]);
      return;
    }
    const body = (await res.json()) as { items: LanguageDto[] };
    setItems(body.items);
  }, [m]);

  useEffect(() => {
    void load();
  }, [load]);

  function startNew() {
    setError(null);
    const start = { ...EMPTY, displayOrder: ((items?.length ?? 0) + 1) * 10 };
    setDraft(start);
    setOriginal(start);
    setEditingId(NEW_ID);
  }

  function startEdit(l: LanguageDto) {
    setError(null);
    const d = { code: l.code, nameJa: l.nameJa, nameEn: l.nameEn, displayOrder: l.displayOrder };
    setDraft(d);
    setOriginal(d);
    setEditingId(l.id);
  }

  function stopEdit() {
    setEditingId(null);
    setDraft(EMPTY);
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const creating = editingId === NEW_ID;
      const res = await fetch(creating ? "/api/languages" : `/api/languages/${editingId}`, {
        method: creating ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: draft.code,
          nameJa: draft.nameJa,
          nameEn: draft.nameEn,
          displayOrder: Number(draft.displayOrder) || 0,
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      stopEdit();
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(l: LanguageDto) {
    if (!confirm(m.regions.deleteConfirm(pickName(locale, l.nameJa, l.nameEn)))) return;
    setError(null);
    const res = await fetch(`/api/languages/${l.id}`, { method: "DELETE" });
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setError(body?.error.message ?? m.errors.deleteFailed);
      return;
    }
    if (editingId === l.id) stopEdit();
    void load();
  }

  // 追加中は、まだ保存していない空の行を先頭に見せる
  const rows: LanguageDto[] =
    editingId === NEW_ID
      ? [{ id: NEW_ID, code: "", nameJa: "", nameEn: "", displayOrder: 0 }, ...(items ?? [])]
      : (items ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{m.languages.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-sm">{m.languages.description}</p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 他の一覧と同じ並び。新規登録は表の左上に「＋」で置く */}
        <div className="flex gap-2">
          {editingId ? (
            <>
              <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
                {saving ? m.common.saving : m.common.save}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={stopEdit}>
                {m.common.cancel}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(original)}>
                {m.common.clear}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="icon"
              className="size-8"
              title={m.table.create}
              aria-label={m.table.create}
              onClick={startNew}
            >
              <Plus className="size-4" />
            </Button>
          )}
        </div>

        <div className="bg-background max-h-96 overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-table-head text-table-head-foreground sticky top-0 [&_th]:text-inherit">
              <TableRow>
                <TableHead className={cn(CELL, "w-20")}>{m.languages.code}</TableHead>
                <TableHead className={CELL}>{m.languages.nameJa}</TableHead>
                <TableHead className={CELL}>{m.languages.nameEn}</TableHead>
                <TableHead className={cn(CELL, "w-20 text-right")}>
                  {m.languages.displayOrder}
                </TableHead>
                <TableHead className={cn(CELL, "w-16")} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items === null && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {m.common.loading}
                  </TableCell>
                </TableRow>
              )}
              {items?.length === 0 && editingId === null && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {m.languages.empty}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((l) => {
                const editing = l.id === editingId;
                return (
                  <TableRow
                    key={l.id}
                    onDoubleClick={editingId ? undefined : () => startEdit(l)}
                    className={cn(!editingId && "cursor-pointer")}
                  >
                    <TableCell className={cn(CELL, "font-mono")}>
                      {editing ? (
                        <Input
                          value={draft.code}
                          maxLength={2}
                          aria-label={m.languages.code}
                          onChange={(e) =>
                            setDraft({ ...draft, code: e.target.value.toUpperCase() })
                          }
                          className={cn(CELL_INPUT, "font-mono")}
                        />
                      ) : (
                        l.code
                      )}
                    </TableCell>
                    <TableCell className={CELL}>
                      {editing ? (
                        <Input
                          value={draft.nameJa}
                          maxLength={100}
                          aria-label={m.languages.nameJa}
                          onChange={(e) => setDraft({ ...draft, nameJa: e.target.value })}
                          className={CELL_INPUT}
                        />
                      ) : (
                        l.nameJa
                      )}
                    </TableCell>
                    <TableCell className={CELL}>
                      {editing ? (
                        <Input
                          value={draft.nameEn}
                          maxLength={100}
                          aria-label={m.languages.nameEn}
                          onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
                          className={CELL_INPUT}
                        />
                      ) : (
                        l.nameEn
                      )}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-muted-foreground text-right")}>
                      {editing ? (
                        <Input
                          type="number"
                          min={0}
                          max={9999}
                          value={draft.displayOrder}
                          aria-label={m.languages.displayOrder}
                          onChange={(e) =>
                            setDraft({ ...draft, displayOrder: Number(e.target.value) })
                          }
                          className={cn(CELL_INPUT, "text-right")}
                        />
                      ) : (
                        l.displayOrder
                      )}
                    </TableCell>
                    <TableCell className={cn(CELL, "text-center")}>
                      {!editingId && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title={m.common.delete}
                          aria-label={m.common.delete}
                          onClick={() => void remove(l)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
