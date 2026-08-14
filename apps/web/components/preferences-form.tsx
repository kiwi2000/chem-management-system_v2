"use client";

import {
  LOCALES,
  LOCALE_LABELS,
  PATTERN_BACKGROUNDS,
  PICTURE_BACKGROUNDS,
  THEMES,
  THEME_STRONG_SWATCH,
  THEME_SWATCHES,
  type Background,
  type Locale,
  type Theme,
} from "@chem/shared";
import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";
import { cn } from "@/lib/utils";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

/**
 * 配色の見本。実際の画面と同じ色の値を使っている。
 * 「見出しを塗る」が入のときは、上端にその色を出して塗った結果まで分かるようにする。
 */
function Swatch({ theme, headerStrong }: { theme: Theme; headerStrong: boolean }) {
  const [bg, fg, accent] = THEME_SWATCHES[theme];
  return (
    <span
      className="flex size-9 shrink-0 flex-col overflow-hidden rounded border"
      style={{ backgroundColor: bg }}
      aria-hidden
    >
      {headerStrong && (
        <span
          className="block h-2.5 w-full"
          style={{ backgroundColor: THEME_STRONG_SWATCH[theme] }}
        />
      )}
      <span className="flex flex-1 items-center justify-center">
        <span className="size-3 rounded-full" style={{ backgroundColor: fg }} />
        <span className="ml-0.5 size-3 rounded-full" style={{ backgroundColor: accent }} />
      </span>
    </span>
  );
}

/**
 * 個人設定。
 * 選んだ時点ですぐ保存して画面に反映する（保存ボタンを押させない）。
 * 見た目の設定は、押した結果がその場で見えたほうが選びやすいため。
 */
export function PreferencesForm({
  locale,
  theme,
  headerStrong,
  background,
  displayName,
}: {
  locale: Locale;
  theme: Theme;
  headerStrong: boolean;
  background: Background;
  displayName: string;
}) {
  const { m } = useI18n();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 表示名だけは打ち終わってから保存するので、入力中の値を持つ
  const [name, setName] = useState(displayName);
  const [themeOpen, setThemeOpen] = useState(false);

  async function save(patch: {
    locale?: Locale;
    theme?: Theme;
    headerStrong?: boolean;
    background?: Background;
    displayName?: string;
  }) {
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
        if (redirectIfUnauthorized(res)) return;
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

  // 表示名は空欄にできない。保存ボタンを押せなくして、理由もその場に出す
  const nameEmpty = name.trim().length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{m.preferences.profile}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameEmpty) return;
              void save({ displayName: name.trim() });
            }}
          >
            <Label htmlFor="displayName">{m.preferences.displayName}</Label>
            <div className="flex flex-wrap items-start gap-2">
              <Input
                id="displayName"
                value={name}
                maxLength={200}
                aria-invalid={nameEmpty}
                onChange={(e) => setName(e.target.value)}
                className="max-w-xs"
              />
              <Button type="submit" disabled={saving || nameEmpty || name.trim() === displayName}>
                {m.common.save}
              </Button>
            </div>
            <p className={nameEmpty ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
              {nameEmpty ? m.errors.displayNameRequired : m.preferences.displayNameHint}
            </p>
          </form>
        </CardContent>
      </Card>

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

          {/*
            テーマは種類が多く場所を取るので、既定では畳んでおく。
            畳んだ行にも今の配色の見本を出して、開かなくても何を選んでいるか分かるようにする。
          */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setThemeOpen((v) => !v)}
                aria-expanded={themeOpen}
                className="hover:bg-muted flex min-w-56 flex-1 items-center gap-3 rounded-md border p-2 text-left transition-colors"
              >
                <Swatch theme={theme} headerStrong={headerStrong} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{m.preferences.theme}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {m.preferences.themes[theme]}
                  </span>
                </span>
                <ChevronDown
                  className={cn("size-4 shrink-0 transition-transform", themeOpen && "rotate-180")}
                />
              </button>

              {/* テーマとは独立した設定。どの配色でも入切できる */}
              <label
                className="flex shrink-0 items-center gap-2 text-sm"
                title={m.preferences.headerStrongHint}
              >
                <input
                  type="checkbox"
                  checked={headerStrong}
                  disabled={saving}
                  onChange={(e) => void save({ headerStrong: e.target.checked })}
                />
                {m.preferences.headerStrong}
              </label>

              {/* 背景もテーマとは独立。名前で選べるので、場所を取らないプルダウンにする */}
              <Label
                htmlFor="background"
                className="shrink-0 text-sm font-normal"
                title={m.preferences.backgroundHint}
              >
                {m.preferences.background}
              </Label>
              <select
                id="background"
                value={background}
                disabled={saving}
                title={m.preferences.backgroundHint}
                onChange={(e) => void save({ background: e.target.value as Background })}
                className="border-input bg-background h-9 shrink-0 rounded-md border px-2 text-sm"
              >
                <option value="none">{m.preferences.backgrounds.none}</option>
                <optgroup label={m.preferences.backgroundPatterns}>
                  {PATTERN_BACKGROUNDS.map((b) => (
                    <option key={b} value={b}>
                      {m.preferences.backgrounds[b]}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={m.preferences.backgroundPictures}>
                  {PICTURE_BACKGROUNDS.map((b) => (
                    <option key={b} value={b}>
                      {m.preferences.backgrounds[b]}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {themeOpen && (
              <>
                <p className="text-muted-foreground text-xs">{m.preferences.themeHint}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {THEMES.map((t) => {
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
                        <Swatch theme={t} headerStrong={headerStrong} />
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
              </>
            )}
          </div>
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
