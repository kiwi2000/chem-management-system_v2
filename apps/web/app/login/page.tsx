"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import { fetchPasskeyOptions, passkeySupported, signWithPasskey } from "@/lib/passkey-client";
import type { ApiError } from "@/lib/types";

/**
 * セッションが切れて送り返されたときだけ、その理由を出す。
 * useSearchParams はビルド時に Suspense を要求するので、この部分だけ切り出してある。
 */
function ExpiredNotice() {
  const { m } = useI18n();
  const params = useSearchParams();
  const shown = params.get("expired") === "1";
  /*
    なぜ切れたのかはサーバーが覚えている（セッションの行に印が付く）。
    画面側では分からないので聞きに行く。
    放置だけは画面側で分かっているので、URLに付いてくるぶんを先に使い、
    答えを待つあいだの空白を作らない
  */
  const [reason, setReason] = useState<string | null>(
    params.get("reason") === "idle" ? "idle" : null,
  );

  useEffect(() => {
    if (!shown || reason === "idle") return;
    let alive = true;
    void (async () => {
      const res = await fetch("/api/auth/session-end").catch(() => null);
      if (!res?.ok || !alive) return;
      const body = (await res.json()) as { reason: string | null };
      if (alive && body.reason) setReason(body.reason);
    })();
    return () => {
      alive = false;
    };
  }, [shown, reason]);

  if (!shown) return null;
  const text =
    reason === "idle"
      ? m.login.sessionIdle
      : reason === "settings"
        ? m.login.sessionSettingsChanged
        : reason === "expired"
          ? m.login.sessionTimedOut
          : reason === "maintenance"
            ? m.login.sessionMaintenance
            : reason === "admin"
              ? m.login.sessionAdminEnded
              : m.login.sessionExpired;
  return (
    <Alert variant="destructive">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}

export default function LoginPage() {
  const { m } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  /** 目のボタンを押しているあいだだけ true。指を離すとすぐ隠す */
  const [peek, setPeek] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // パスキーが使える端末かは、画面が出てから調べる（サーバー側では分からない）
  const [canPasskey, setCanPasskey] = useState(false);
  /** メンテナンス中か。入れないことを、試す前に知らせる */
  const [maintenance, setMaintenance] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/maintenance").catch(() => null);
      if (!res?.ok) return;
      const body = (await res.json()) as { on: boolean };
      if (alive) setMaintenance(body.on);
    })();
    return () => {
      alive = false;
    };
  }, []);
  /** パスキーの窓を待っているか。パスワードの「ログイン中」と分けて見せる */
  const [passkeyWaiting, setPasskeyWaiting] = useState(false);
  /** 赤くない知らせ。パスキーをやめた（または無かった）ときの案内 */
  const [passkeyNotice, setPasskeyNotice] = useState<string | null>(null);

  useEffect(() => setCanPasskey(passkeySupported()), []);

  /**
   * パスキーで入る。
   * **メールアドレスもパスワードも打たない。**端末が誰の鍵かを覚えている
   */
  async function signInWithPasskey() {
    setError(null);
    setPasskeyNotice(null);
    setLoading(true);
    setPasskeyWaiting(true);
    try {
      const optRes = await fetchPasskeyOptions("/api/auth/passkey/login");
      if (!optRes) {
        setError(m.passkey.noServerReply);
        return;
      }
      if (!optRes.ok) {
        setError(m.login.failed);
        return;
      }
      const outcome = await signWithPasskey(await optRes.json());
      if (!outcome.ok) {
        /*
          やめただけなら赤い字は出さない。壊れたように見せない。
          ただし**この端末に鍵が無い人**も同じ形で戻ってくる（端末は区別して教えてくれない）ので、
          薄い字で「無ければパスワードで」と添える
        */
        if (outcome.reason === "timeout") {
          setPasskeyNotice(m.passkey.timeoutHint);
          return;
        }
        if (outcome.reason === "cancelled") {
          setPasskeyNotice(m.passkey.signInCancelledHint);
          return;
        }
        setError(outcome.reason === "unsupported" ? m.passkey.unsupported : m.passkey.failed);
        return;
      }
      const res = await fetch("/api/auth/passkey/login", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outcome.value),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as ApiError | null;
        setError(b?.error.message ?? m.login.failed);
        return;
      }
      const body = (await res.json()) as { mustChangePassword: boolean };
      // パスワードのときと同じ理由で、読み込み直して入る
      window.location.assign(body.mustChangePassword ? "/change-password" : "/");
    } finally {
      setLoading(false);
      setPasskeyWaiting(false);
    }
  }

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

      /*
        ログインできたのに、ブラウザがCookieを保存できていないことがある。
        （そのブラウザに同じ場所のCookieが溜まりすぎている、拒否している、など）
        このとき何もせずに進むと、次の画面で未ログイン扱いになってここへ戻され、
        利用者からは「押しても何も起きない」ようにしか見えない。実際にそれで
        原因が分からず、何度も押し直すことになった。

        1回だけ確かめて、駄目なら何が起きているかを伝える。
      */
      if (!(await fetch("/api/me")).ok) {
        setError(m.login.cookieBlocked);
        return;
      }

      /*
        画面内での移動ではなく、読み込み直して入る。

        ログインでCookieが変わった直後は、画面内で移動しても
        中身が入れ替わらないことがある（実際、押しても何も起きず、
        F5で初めて入れる状態になっていた）。
        ログインは何度もする操作ではないので、確実さを取る。
      */
      window.location.assign(body.mustChangePassword ? "/change-password" : "/");
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
          {maintenance && (
            <Alert>
              <AlertDescription>{m.login.maintenance}</AlertDescription>
            </Alert>
          )}
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

            {/*
              パスキーは別の入りかたなので、フォームの外に置く。
              中に入れると Enter で誤って押されうる。
              使える端末のときだけ出す（無い端末に押せないボタンを見せない）
            */}
            {canPasskey && (
              <div className="mt-4 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full"
                  disabled={loading}
                  onClick={() => void signInWithPasskey()}
                >
                  <KeyRound className="size-4" />
                  {passkeyWaiting ? m.passkey.waitingShort : m.passkey.signIn}
                </Button>
                {/* 待っているあいだは、ブラウザの窓を見てもらう。窓は別の画面の後ろに出ることがある */}
                {passkeyWaiting ? (
                  <p className="text-muted-foreground mt-2 text-xs">{m.passkey.waiting}</p>
                ) : passkeyNotice ? (
                  <p className="text-muted-foreground mt-2 text-xs">{passkeyNotice}</p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
