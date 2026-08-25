"use client";

import {
  COMPOSITION_VALIDATION_MODES,
  DEFAULT_SETTINGS,
  describePasswordPolicy,
  formatOptionList,
  parseOptionList,
  pickPasswordPolicy,
  PASSWORD_MAX_LENGTH_CEILING,
  PASSWORD_MIN_LENGTH_FLOOR,
  SESSION_IDLE_MIN,
  SESSION_IDLE_MAX,
  type AppSettings,
  type CompositionValidationMode,
  type PendingResolution,
} from "@chem/shared";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LanguageSection } from "@/components/language-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

export default function SettingsPage() {
  const { m } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  /** 読み込んだ直後の内容。「変更を破棄」で戻す先 */
  const [loaded, setLoaded] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 選択肢の入力欄は打っている途中の改行を消さないよう、生の文字列のまま持つ
  const [modelOptionsText, setModelOptionsText] = useState("");
  const [useOptionsText, setUseOptionsText] = useState("");
  // 承認を不要に切り替えたときに残る承認待の件数（種類ごと）
  const [pending, setPending] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
        setSettings({ ...DEFAULT_SETTINGS });
        setLoaded({ ...DEFAULT_SETTINGS });
        return;
      }
      const fresh = ((await res.json()) as { settings: AppSettings }).settings;
      setSettings(fresh);
      setLoaded(fresh);
      setModelOptionsText(formatOptionList(fresh.productModelOptions));
      setUseOptionsText(formatOptionList(fresh.productUseOptions));
    })();
  }, [m]);

  /**
   * 保存。承認を「必要 → 不要」に切り替えると承認待のものが宙に浮くので、
   * サーバーが 409 で扱いを聞いてくる。選んでもらってから同じ内容を送り直す。
   */
  /** 書きかけを捨てて、読み込んだときの内容に戻す */
  function discard() {
    if (!loaded) return;
    setSettings(loaded);
    setModelOptionsText(formatOptionList(loaded.productModelOptions));
    setUseOptionsText(formatOptionList(loaded.productUseOptions));
    setError(null);
    setNotice(null);
  }

  async function save(resolution?: Record<string, PendingResolution>) {
    if (!settings) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, pendingResolution: resolution }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        if (res.status === 409) {
          const details = body?.error.details as { pending?: Record<string, number> } | undefined;
          setPending(details?.pending ?? null);
          return;
        }
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setPending(null);
      // 保存できたら、破棄で戻す先も新しい内容にする
      setLoaded(settings);
      setNotice(m.settings.saved);
    } finally {
      setSaving(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await save();
  }

  /** 承認待の扱いを1つ選んで、その内容で保存し直す */
  function resolveAll(how: PendingResolution) {
    const resolution: Record<string, PendingResolution> = {};
    for (const entity of Object.keys(pending ?? {})) resolution[entity] = how;
    void save(resolution);
  }

  if (!settings) {
    return (
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        <p className="text-muted-foreground">{m.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{m.settings.title}</h1>
      <p className="text-muted-foreground text-sm">{m.settings.description}</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.settings.substanceSection}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.casRequired}
                onChange={(e) => setSettings({ ...settings, casRequired: e.target.checked })}
              />
              <span>
                <span className="block">{m.settings.casRequired}</span>
                <span className="text-muted-foreground block text-xs">
                  {m.settings.casRequiredHint}
                </span>
              </span>
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.casFormatEnforced}
                onChange={(e) => setSettings({ ...settings, casFormatEnforced: e.target.checked })}
              />
              <span>
                <span className="block">{m.settings.casFormatEnforced}</span>
                <span className="text-muted-foreground block text-xs">
                  {m.settings.casFormatEnforcedHint}
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.settings.compositionSection}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="validationMode">{m.settings.validationMode}</Label>
              <select
                id="validationMode"
                value={settings.compositionValidationMode}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    compositionValidationMode: e.target.value as CompositionValidationMode,
                  })
                }
                className="border-input bg-background h-9 w-full max-w-md rounded-none border px-2 text-sm"
              >
                {COMPOSITION_VALIDATION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {m.settings.validationModes[mode]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="epsilon">{m.settings.epsilonPct}</Label>
              <Input
                id="epsilon"
                inputMode="decimal"
                autoComplete="off"
                value={settings.compositionEpsilonPct}
                onChange={(e) =>
                  setSettings({ ...settings, compositionEpsilonPct: e.target.value })
                }
                className="w-28"
              />
              <p className="text-muted-foreground text-xs">{m.settings.epsilonPctHint}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.settings.approvalSection}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.substanceApprovalRequired}
                onChange={(e) =>
                  setSettings({ ...settings, substanceApprovalRequired: e.target.checked })
                }
              />
              <span>
                <span className="block">{m.settings.substanceApprovalRequired}</span>
                <span className="text-muted-foreground block text-xs">
                  {m.settings.approvalHint}
                </span>
              </span>
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.productApprovalRequired}
                onChange={(e) =>
                  setSettings({ ...settings, productApprovalRequired: e.target.checked })
                }
              />
              <span>
                <span className="block">{m.settings.productApprovalRequired}</span>
                <span className="text-muted-foreground block text-xs">
                  {m.settings.approvalHint}
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.settings.productSection}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 1行1件。並べた順がそのまま製品画面のプルダウンの順になる */}
            <div className="space-y-2">
              <Label htmlFor="modelOptions">{m.settings.modelOptions}</Label>
              <textarea
                id="modelOptions"
                rows={5}
                value={modelOptionsText}
                onChange={(e) => {
                  setModelOptionsText(e.target.value);
                  setSettings({
                    ...settings,
                    productModelOptions: parseOptionList(e.target.value),
                  });
                }}
                className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">{m.settings.optionListHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="useOptions">{m.settings.useOptions}</Label>
              <textarea
                id="useOptions"
                rows={5}
                value={useOptionsText}
                onChange={(e) => {
                  setUseOptionsText(e.target.value);
                  setSettings({ ...settings, productUseOptions: parseOptionList(e.target.value) });
                }}
                className="border-input bg-background w-full rounded-none border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">{m.settings.optionListHint}</p>
            </div>
          </CardContent>
        </Card>

        {/* 言語は地域・国と同じマスタ。行の中で直す */}
        <LanguageSection />

        {pending && (
          <Alert>
            <AlertDescription>
              <p className="font-medium">{m.settings.pendingTitle}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {Object.entries(pending).map(([entity, count]) => (
                  <li key={entity}>
                    {entity === "substance" ? m.nav.substances : m.nav.products}: {count} 件
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-xs">{m.settings.pendingHint}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => resolveAll("publish")}
                >
                  {m.settings.pendingPublish}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => resolveAll("draft")}
                >
                  {m.settings.pendingDraft}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setPending(null)}>
                  {m.common.cancel}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.settings.sessionSection}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="idleMinutes">{m.settings.sessionIdleMinutes}</Label>
            <Input
              id="idleMinutes"
              type="number"
              min={SESSION_IDLE_MIN}
              max={SESSION_IDLE_MAX}
              step={1}
              value={settings.sessionIdleMinutes}
              onChange={(e) =>
                setSettings({ ...settings, sessionIdleMinutes: Number(e.target.value) })
              }
              className="w-28"
            />
            <p className="text-muted-foreground text-xs">{m.settings.sessionIdleHint}</p>
            <p className="text-muted-foreground text-xs">{m.settings.sessionIdleRange}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.mfa.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.mfaRequired}
                onChange={(e) => setSettings({ ...settings, mfaRequired: e.target.checked })}
              />
              {m.settings.mfaRequired}
            </label>
            <p className="text-muted-foreground text-xs">{m.mfa.requiredHint}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{m.settings.passwordSection}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground text-sm">{m.settings.passwordSectionHint}</p>

            <div className="space-y-2">
              <Label htmlFor="pwMin">{m.settings.passwordMinLength}</Label>
              <Input
                id="pwMin"
                type="number"
                min={PASSWORD_MIN_LENGTH_FLOOR}
                max={PASSWORD_MAX_LENGTH_CEILING}
                step={1}
                value={settings.passwordMinLength}
                onChange={(e) =>
                  setSettings({ ...settings, passwordMinLength: Number(e.target.value) })
                }
                className="w-28"
              />
              <p className="text-muted-foreground text-xs">{m.settings.passwordMinLengthRange}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{m.settings.passwordRequiredKinds}</p>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.passwordRequireLetter}
                    onChange={(e) =>
                      setSettings({ ...settings, passwordRequireLetter: e.target.checked })
                    }
                  />
                  {m.settings.kindLetter}
                </label>
                {/* 大文字小文字の混在は、英字を求めていなければ意味を持たない */}
                {settings.passwordRequireLetter && (
                  <span className="text-muted-foreground -ml-4 flex items-center">
                    （
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={settings.passwordRequireMixedCase}
                        onChange={(e) =>
                          setSettings({ ...settings, passwordRequireMixedCase: e.target.checked })
                        }
                      />
                      {m.settings.kindMixedCase}
                    </label>
                    ）
                  </span>
                )}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.passwordRequireDigit}
                    onChange={(e) =>
                      setSettings({ ...settings, passwordRequireDigit: e.target.checked })
                    }
                  />
                  {m.settings.kindDigit}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.passwordRequireSymbol}
                    onChange={(e) =>
                      setSettings({ ...settings, passwordRequireSymbol: e.target.checked })
                    }
                  />
                  {m.settings.kindSymbol}
                </label>
              </div>
            </div>

            {/* 記号を求めるときだけ意味を持つので、外しているあいだは出さない */}
            {settings.passwordRequireSymbol && (
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="pwSymbols" className="shrink-0">
                  {m.settings.kindSymbol}
                </Label>
                <Input
                  id="pwSymbols"
                  value={settings.passwordSymbolChars}
                  onChange={(e) =>
                    setSettings({ ...settings, passwordSymbolChars: e.target.value })
                  }
                  className="w-auto min-w-72 flex-1 font-mono"
                />
                <p className="text-muted-foreground w-full text-xs">
                  {m.settings.passwordSymbolCharsHint}
                </p>
              </div>
            )}

            {/* 決めた内容が実際どう伝わるかを、その場で見せる */}
            <p className="text-sm">
              <span className="text-muted-foreground">{m.settings.passwordPreview}: </span>
              {describePasswordPolicy(m, pickPasswordPolicy(settings))}
            </p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? m.common.saving : m.common.save}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={discard}>
            {m.common.discard}
          </Button>
        </div>
      </form>
    </div>
  );
}
