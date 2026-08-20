"use client";

import {
  COMPOSITION_VALIDATION_MODES,
  DEFAULT_SETTINGS,
  formatOptionList,
  parseOptionList,
  type AppSettings,
  type CompositionValidationMode,
} from "@chem/shared";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 選択肢の入力欄は打っている途中の改行を消さないよう、生の文字列のまま持つ
  const [modelOptionsText, setModelOptionsText] = useState("");
  const [useOptionsText, setUseOptionsText] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
        setSettings({ ...DEFAULT_SETTINGS });
        return;
      }
      const loaded = ((await res.json()) as { settings: AppSettings }).settings;
      setSettings(loaded);
      setModelOptionsText(formatOptionList(loaded.productModelOptions));
      setUseOptionsText(formatOptionList(loaded.productUseOptions));
    })();
  }, [m]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setNotice(m.settings.saved);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-muted-foreground">{m.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
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
                value={settings.compositionEpsilonPct}
                onChange={(e) =>
                  setSettings({ ...settings, compositionEpsilonPct: e.target.value })
                }
                className="w-28"
              />
              <p className="text-muted-foreground text-xs">{m.settings.epsilonPctHint}</p>
            </div>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.compositionBalanceAllowed}
                onChange={(e) =>
                  setSettings({ ...settings, compositionBalanceAllowed: e.target.checked })
                }
              />
              <span>
                <span className="block">{m.settings.balanceAllowed}</span>
                <span className="text-muted-foreground block text-xs">
                  {m.settings.balanceAllowedHint}
                </span>
              </span>
            </label>
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

        <Button type="submit" disabled={saving}>
          {saving ? m.common.saving : m.common.save}
        </Button>
      </form>
    </div>
  );
}
