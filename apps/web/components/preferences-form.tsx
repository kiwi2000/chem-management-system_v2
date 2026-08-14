"use client";

import {
  LOCALES,
  LOCALE_LABELS,
  THEMES,
  THEME_STRONG_SWATCH,
  THEME_SWATCHES,
  type Locale,
  type Theme,
} from "@chem/shared";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 個人設定。
 * 選んだ時点ですぐ保存して画面に反映する（保存ボタンを押させない）。
 * 見た目の設定は、押した結果がその場で見えたほうが選びやすいため。
 */
export function PreferencesForm({
  locale,
  theme,
  headerStrong,
}: {
  locale: Locale;
  theme: Theme;
  headerStrong: boolean;
}) {
  const { m } = useI18n();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(patch: { locale?: Locale; theme?: Theme; headerStrong?: boolean }) {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setNotice(m.preferences.saved);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.preferences.display}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="locale">{m.preferences.language}</Label>
            <select
              id="locale"
              value={locale}
              disabled={saving}
              onChange={(e) => void save({ locale: e.target.value as Locale })}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l]}
                </option>
              ))}
            </select>
            <p className="text-muted-foreground text-xs">{m.preferences.languageHint}</p>
          </div>

          <div className="space-y-2">
            <Label>{m.preferences.theme}</Label>
            <p className="text-muted-foreground text-xs">{m.preferences.themeHint}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {THEMES.map((t) => {
                const [bg, fg, accent] = THEME_SWATCHES[t];
                const selected = t === theme;
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={saving}
                    onClick={() => void save({ theme: t })}
                    aria-pressed={selected}
                    className={cn(
                      "flex items-center gap-3 rounded-md border p-3 text-left transition-colors",
                      selected ? "border-primary bg-secondary" : "hover:bg-muted",
                    )}
                  >
                    {/* 配色の見本。実際の色と同じ値を使っている */}
                    <span
                      className="flex size-9 shrink-0 flex-col overflow-hidden rounded border"
                      style={{ backgroundColor: bg }}
                      aria-hidden
                    >
                      {/* ヘッダーを濃くしているときは、上端にその色を出す */}
                      {headerStrong && (
                        <span
                          className="block h-2.5 w-full"
                          style={{ backgroundColor: THEME_STRONG_SWATCH[t] }}
                        />
                      )}
                      <span className="flex flex-1 items-center justify-center">
                        <span className="size-3 rounded-full" style={{ backgroundColor: fg }} />
                        <span
                          className="ml-0.5 size-3 rounded-full"
                          style={{ backgroundColor: accent }}
                        />
                      </span>
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-sm font-medium">
                        {m.preferences.themes[t]}
                        {selected && <Check className="size-3.5" />}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {m.preferences.themeDescriptions[t]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* テーマとは独立した設定。どの配色でも入切できる */}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={headerStrong}
              disabled={saving}
              onChange={(e) => void save({ headerStrong: e.target.checked })}
            />
            <span>
              <span className="block">{m.preferences.headerStrong}</span>
              <span className="text-muted-foreground block text-xs">
                {m.preferences.headerStrongHint}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.preferences.account}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" nativeButton={false} render={<Link href="/change-password" />}>
            {m.preferences.changePassword}
          </Button>
        </CardContent>
      </Card>

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
    </div>
  );
}
