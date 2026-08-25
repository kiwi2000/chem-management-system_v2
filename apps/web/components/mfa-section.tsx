"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

interface Status {
  method: "none" | "totp";
  required: boolean;
}

/**
 * 自分の2要素認証。
 *
 * 有効にするまでを2段にしている。鍵を作る → 認証アプリが出した6桁を確かめる。
 * 一度で有効にすると、読み取りに失敗した人が自分の口座から締め出されるため。
 */
export function MfaSection() {
  const { m } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 登録の途中。QRコードと手入力用の文字列を持つ */
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  /** 解除のときだけ出すパスワードの欄 */
  const [password, setPassword] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/mfa").catch(() => null);
    if (!res?.ok) return;
    setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(method: string, body?: unknown): Promise<unknown | null> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa", {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return null;
        const e = (await res.json().catch(() => null)) as ApiError | null;
        setError(e?.error.message ?? m.errors.saveFailed(res.status));
        return null;
      }
      return await res.json();
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const body = (await call("POST")) as { secret: string; uri: string } | null;
    if (!body) return;
    // QRコードはサーバーで絵にしてもらう。外部の画像置き場は使わない
    const res = await fetch(`/api/auth/mfa/qr?uri=${encodeURIComponent(body.uri)}`);
    setSetup({ qr: res.ok ? await res.text() : "", secret: body.secret });
    setCode("");
  }

  async function confirm() {
    if (!(await call("PUT", { totp: code }))) return;
    setSetup(null);
    setCode("");
    await load();
  }

  async function disable() {
    if (!(await call("DELETE", { password }))) return;
    setPassword(null);
    await load();
  }

  const enabled = status?.method === "totp";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{m.mfa.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm leading-relaxed">{m.mfa.lead}</p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <p className="text-sm">
          <span className="text-muted-foreground">{m.mfa.method} </span>
          <span className="font-medium">
            {enabled ? m.mfa.methodTotp : m.mfa.methodNone}
            {enabled ? `（${m.mfa.enabled}）` : `（${m.mfa.notEnabled}）`}
          </span>
        </p>

        {status?.required && !enabled && (
          <Alert>
            <AlertDescription>{m.mfa.required}</AlertDescription>
          </Alert>
        )}

        {/* 登録の途中。QRコードを出して、6桁が出せることを確かめてもらう */}
        {setup && (
          <div className="border-border space-y-3 border p-4">
            <p className="text-sm font-medium">{m.mfa.setupTitle}</p>
            <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
              <li>{m.mfa.setupStep1}</li>
              <li>{m.mfa.setupStep2}</li>
            </ol>
            {setup.qr && (
              /*
                サーバーが作ったSVGをそのまま置く。外へ画像を取りに行かないため。
                中身は自分のサーバーが QRCode.toString で組んだものだけで、
                利用者の入力は入らない。
              */
              <div
                className="bg-white p-2 [&>svg]:size-44"
                dangerouslySetInnerHTML={{ __html: setup.qr }}
              />
            )}
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">{m.mfa.manualKey}</p>
              <p className="font-mono text-sm break-all">{setup.secret}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40 space-y-1">
                <Label htmlFor="mfa-code">{m.mfa.code}</Label>
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="font-mono"
                />
              </div>
              <Button disabled={busy || code.length !== 6} onClick={() => void confirm()}>
                {m.mfa.confirm}
              </Button>
              <Button variant="outline" onClick={() => setSetup(null)}>
                {m.mfa.cancel}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{m.mfa.appHint}</p>
          </div>
        )}

        {/* 解除。守りを1枚外すので、パスワードをもう一度確かめる */}
        {password !== null && (
          <div className="border-border space-y-3 border p-4">
            <div className="w-64 space-y-1">
              <Label htmlFor="mfa-pass">{m.mfa.passwordToDisable}</Label>
              <Input
                id="mfa-pass"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={busy || !password}
                onClick={() => void disable()}
              >
                {m.mfa.disable}
              </Button>
              <Button variant="outline" onClick={() => setPassword(null)}>
                {m.mfa.cancel}
              </Button>
            </div>
          </div>
        )}

        {!setup && password === null && (
          <div className="flex gap-2">
            {!enabled && (
              <Button disabled={busy} onClick={() => void start()}>
                {m.mfa.enable}
              </Button>
            )}
            {enabled && !status?.required && (
              <Button variant="outline" onClick={() => setPassword("")}>
                {m.mfa.disable}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
