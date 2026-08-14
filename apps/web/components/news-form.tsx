"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, NewsDto } from "@/lib/types";

interface Props {
  /** 既存の内容。未指定なら新規作成 */
  initial?: NewsDto;
  /**
   * 編集できるか。既存のお知らせは、まず読み取り専用で見せて
   * 「編集」ボタンを押してから書き換えられるようにする（物質マスタと同じ形）。
   */
  canEdit: boolean;
}

/** お知らせの詳細・作成・編集フォーム */
export function NewsForm({ initial, canEdit }: Props) {
  const router = useRouter();
  const { m } = useI18n();
  const [editing, setEditing] = useState(!initial);
  const readOnly = !canEdit || !editing;
  const [titleJa, setTitleJa] = useState(initial?.titleJa ?? "");
  const [bodyJa, setBodyJa] = useState(initial?.bodyJa ?? "");
  const [titleEn, setTitleEn] = useState(initial?.titleEn ?? "");
  const [bodyEn, setBodyEn] = useState(initial?.bodyEn ?? "");
  const [status, setStatus] = useState<"DRAFT" | "PUBLISHED">(initial?.status ?? "DRAFT");
  const [pinned, setPinned] = useState(initial?.pinned ?? false);
  const [publishFrom, setPublishFrom] = useState(initial?.publishFrom ?? "");
  const [publishUntil, setPublishUntil] = useState(initial?.publishUntil ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(initial ? `/api/news/${initial.id}` : "/api/news", {
        method: initial ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleJa,
          bodyJa,
          titleEn: titleEn || null,
          bodyEn: bodyEn || null,
          status,
          pinned,
          publishFrom: publishFrom || null,
          publishUntil: publishUntil || null,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      router.push("/news");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {initial && (
        <div className="flex items-center gap-3">
          <Badge variant={readOnly ? "outline" : "secondary"}>
            {readOnly ? m.common.viewMode : m.common.editMode}
          </Badge>
          {readOnly && canEdit && (
            <Button type="button" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 size-3.5" />
              {m.common.edit}
            </Button>
          )}
        </div>
      )}

      <fieldset disabled={readOnly} className="space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="titleJa">{m.news.titleJa}</Label>
              <Input
                id="titleJa"
                required
                value={titleJa}
                onChange={(e) => setTitleJa(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bodyJa">{m.news.bodyJa}</Label>
              <textarea
                id="bodyJa"
                required
                rows={6}
                value={bodyJa}
                onChange={(e) => setBodyJa(e.target.value)}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="titleEn">
                {m.news.titleEn}
                {m.common.optional}
              </Label>
              <Input id="titleEn" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bodyEn">
                {m.news.bodyEn}
                {m.common.optional}
              </Label>
              <textarea
                id="bodyEn"
                rows={6}
                value={bodyEn}
                onChange={(e) => setBodyEn(e.target.value)}
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">{m.news.englishHint}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="status">{m.news.status}</Label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "DRAFT" | "PUBLISHED")}
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                <option value="DRAFT">{m.news.draft}</option>
                <option value="PUBLISHED">{m.news.published}</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              {m.news.pinned}
            </label>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-2">
                <Label htmlFor="from">{m.news.publishFrom}</Label>
                <Input
                  id="from"
                  type="date"
                  value={publishFrom}
                  onChange={(e) => setPublishFrom(e.target.value)}
                  className="w-44"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="until">{m.news.publishUntil}</Label>
                <Input
                  id="until"
                  type="date"
                  value={publishUntil}
                  onChange={(e) => setPublishUntil(e.target.value)}
                  className="w-44"
                />
              </div>
            </div>
            <p className="text-muted-foreground text-xs">{m.news.periodHint}</p>
          </CardContent>
        </Card>
      </fieldset>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        {readOnly ? (
          <>
            {canEdit && (
              <Button type="button" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 size-4" />
                {m.common.edit}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => router.push("/news")}>
              {m.common.back}
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" disabled={saving}>
              {saving ? m.common.saving : m.common.save}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // 既存の編集をやめるときは書きかけを捨てて表示に戻す
                if (initial) router.refresh();
                else router.push("/news");
                setEditing(!initial);
              }}
            >
              {m.common.cancel}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
