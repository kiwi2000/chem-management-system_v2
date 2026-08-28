"use client";

import {
  PAGE_SIZE_CHOICE_MAX,
  formatPageSizePrefs,
  pageSizeListProblem,
  parsePageSizeList,
} from "@chem/shared";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { pageSizePrefsChanged, usePageSizePrefs } from "@/lib/page-size-prefs";
import type { ApiError } from "@/lib/types";

/**
 * 1ページの件数の好み。
 *
 * **画面の高さも、一度に読みたい量も人によって違う。**
 * 決め打ちにすると誰かには多すぎ、誰かには少なすぎるので、本人に決めてもらう。
 * ここで決めた並びが、すべての表の件数の選択欄になる。
 */
export function PageSizeSection() {
  const { m } = useI18n();
  const prefs = usePageSizePrefs();

  const [typed, setTyped] = useState(prefs.options.join(", "));
  const [defaultSize, setDefaultSize] = useState(prefs.defaultSize);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const problem = pageSizeListProblem(typed, m.preferences);
  const parsed = problem === null ? parsePageSizeList(typed) : null;
  // 打ち直した並びに無い既定は選べない。いちばん小さいものへ寄せる
  const chosen = parsed && parsed.includes(defaultSize) ? defaultSize : (parsed?.[0] ?? 0);

  async function save() {
    if (!parsed) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageSizes: formatPageSizePrefs({ options: parsed, defaultSize: chosen }),
        }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      // 開いている表にその場で効かせる（Cookie を見ているだけなので、読み直させる）
      pageSizePrefsChanged();
      setTyped(parsed.join(", "));
      setDefaultSize(chosen);
      setNotice(m.preferences.saved);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{m.preferences.pageSize}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">{m.preferences.pageSizeLead}</p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label htmlFor="page-sizes">{m.preferences.pageSizeChoices}</Label>
            <Input
              id="page-sizes"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="15, 25, 50, 100"
              className="w-64"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="page-size-default">{m.preferences.pageSizeDefault}</Label>
            <select
              id="page-size-default"
              value={chosen}
              disabled={!parsed}
              onChange={(e) => setDefaultSize(Number(e.target.value))}
              className="border-input bg-background h-9 w-32 rounded-none border px-2 text-sm"
            >
              {(parsed ?? []).map((n) => (
                <option key={n} value={n}>
                  {m.table.perPage(n)}
                </option>
              ))}
            </select>
          </div>
          <Button disabled={saving || !parsed} onClick={() => void save()}>
            {saving ? m.common.saving : m.common.save}
          </Button>
        </div>

        {problem !== null ? (
          <p className="text-destructive text-xs">{problem}</p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {m.preferences.pageSizeHint(PAGE_SIZE_CHOICE_MAX)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
