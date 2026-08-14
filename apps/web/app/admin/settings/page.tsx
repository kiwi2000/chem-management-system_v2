"use client";

import { DEFAULT_SETTINGS, type AppSettings } from "@chem/shared";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";

export default function SettingsPage() {
  const { m } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      setSettings(((await res.json()) as { settings: AppSettings }).settings);
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
