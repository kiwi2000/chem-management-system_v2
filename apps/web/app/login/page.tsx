"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const { m } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | (ApiError & { error: { details?: { mfaRequired?: boolean } } })
          | { mfaRequired: true }
          | null;
        // 多要素認証のコード待ち（パスワードは正しい）
        if (body && "mfaRequired" in body && body.mfaRequired) {
          setMfaRequired(true);
          setError(m.login.mfaPrompt);
          return;
        }
        const apiErr = body as ApiError | null;
        if (apiErr?.error.code === "mfa_invalid") setMfaRequired(true);
        setError(apiErr?.error.message ?? m.login.failed);
        return;
      }
      const body = (await res.json()) as { mustChangePassword: boolean };
      router.push(body.mustChangePassword ? "/change-password" : "/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-3">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{m.common.appName}</CardTitle>
            <CardDescription>{m.login.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{m.login.email}</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{m.login.password}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {mfaRequired && (
                <div className="space-y-2">
                  <Label htmlFor="totp">{m.login.totp}</Label>
                  <Input
                    id="totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    placeholder="000000"
                  />
                </div>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? m.login.submitting : m.login.submit}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
