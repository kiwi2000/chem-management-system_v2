"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

/**
 * セッションが切れて送り返されたときだけ、その理由を出す。
 * useSearchParams はビルド時に Suspense を要求するので、この部分だけ切り出してある。
 */
function ExpiredNotice() {
  const { m } = useI18n();
  const expired = useSearchParams().get("expired") === "1";
  if (!expired) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{m.login.sessionExpired}</AlertDescription>
    </Alert>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { m } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  /** 目のボタンを押しているあいだだけ true。指を離すとすぐ隠す */
  const [peek, setPeek] = useState(false);
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
        <Suspense>
          <ExpiredNotice />
        </Suspense>
        <Card>
          <CardHeader>
            {/* 説明文は置かず、システム名だけを大きく中央に出す */}
            <CardTitle className="text-center text-xl">{m.common.appName}</CardTitle>
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
                <div className="relative">
                  <Input
                    id="password"
                    type={peek ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-9"
                  />
                  {/*
                    押しているあいだだけ見せる。
                    離す・指が外へ出る・別の場所へ移る、のどれでも隠すようにして、
                    見えたまま置き去りになることが無いようにする。
                    form の中なので type="button"（押すと送信されてしまうため）
                  */}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={m.login.peekPassword}
                    title={m.login.peekPassword}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 -translate-y-1/2 p-1.5"
                    onPointerDown={() => setPeek(true)}
                    onPointerUp={() => setPeek(false)}
                    onPointerLeave={() => setPeek(false)}
                    onPointerCancel={() => setPeek(false)}
                    onBlur={() => setPeek(false)}
                  >
                    {peek ? (
                      <Eye className="size-4" aria-hidden />
                    ) : (
                      <EyeOff className="size-4" aria-hidden />
                    )}
                  </button>
                </div>
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
              {/* 入力欄と地続きに見えないよう、ボタンの上だけ少し余分に空ける */}
              <div className="pt-2">
                {/* この画面の主役なので、他の画面のボタンより高くして押しやすくする */}
                <Button type="submit" className="h-10 w-full" disabled={loading}>
                  {loading ? m.login.submitting : m.login.submit}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
