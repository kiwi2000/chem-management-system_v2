"use client";

import { describePasswordPolicy } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldError } from "@/components/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { firstError, summaryError, toFieldErrors, type FieldErrors } from "@/lib/field-errors";
import { fetchPasskeyOptions, signWithPasskey } from "@/lib/passkey-client";
import { useI18n } from "@/lib/i18n-client";
import { passwordProblem } from "@/lib/password-check";
import { usePasswordPolicy } from "@/lib/use-password-policy";
import type { ApiError } from "@/lib/types";

/**
 * パスワード変更の欄。
 *
 * **なぜ出ているのかを上に書く。**初期パスワードのまま入った人と、
 * 有効期限が切れた人（2026-09-17 指示）では、断り書きを変える。
 * どちらの場合も、変えるまで他の画面は開けない（lib/pending-step.ts）
 *
 * **パスキーを登録している人は、今のパスワードの代わりにパスキーで確かめて変えられる**（2026-11-18 指示）。
 * パスワードを忘れても、管理者に頼まずに作り直せるように。確かめるのは変える直前
 */
export function ChangePasswordForm({
  expired = false,
  passkey = false,
}: {
  expired?: boolean;
  /** この人がパスキーを登録しているか（サーバーが決める） */
  passkey?: boolean;
}) {
  const router = useRouter();
  const { m } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // どの欄が悪いのかを、その欄の下に出す。まとめて「誤りがあります」だけでは直せない
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const fieldError = (key: string) => firstError(fieldErrors, key);
  // 直した欄の指摘は、その場で引っ込める。直したのに赤いままだと、直っていないように見える
  const clearField = (key: string) =>
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  const policy = usePasswordPolicy();
  // 打っている最中から決まりを見る。確認欄は、打ち終わるまで食い違いを責めない
  const pwProblem = passwordProblem(newPassword, m, policy);
  const mismatch =
    confirmPassword !== "" && confirmPassword !== newPassword
      ? m.validation.passwordMismatch
      : null;
  const [done, setDone] = useState(false);
  // 今のパスワードの代わりにパスキーで確かめるか
  const [withPasskey, setWithPasskey] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** パスキーで確かめてから送る。やめた・確かめられなかったときは null（理由はここで出す） */
  async function sendWithPasskey(): Promise<Response | null> {
    const optRes = await fetchPasskeyOptions("/api/auth/change-password/passkey");
    if (!optRes) {
      setError(m.passkey.noServerReply);
      return null;
    }
    if (!optRes.ok) return optRes;
    const outcome = await signWithPasskey(await optRes.json());
    if (!outcome.ok) {
      if (outcome.reason === "cancelled") setNotice(m.changePassword.passkeyCancelled);
      else if (outcome.reason === "timeout") setNotice(m.passkey.timeoutHint);
      else setError(outcome.reason === "unsupported" ? m.passkey.unsupported : m.passkey.failed);
      return null;
    }
    return fetch("/api/auth/change-password/passkey", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response: outcome.value, newPassword, confirmPassword }),
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setFieldErrors({});
    // パスキーの確認を出す前に、手元で分かる誤りは止める（確かめたあとで断られると、もう一度やり直しになる）
    if (withPasskey && (pwProblem || newPassword !== confirmPassword)) {
      setFieldErrors({
        ...(pwProblem ? { newPassword: [pwProblem] } : {}),
        ...(newPassword !== confirmPassword
          ? { confirmPassword: [m.validation.passwordMismatch] }
          : {}),
      });
      return;
    }
    setLoading(true);
    try {
      const res = withPasskey
        ? await sendWithPasskey()
        : await fetch("/api/auth/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
          });
      if (!res) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        const byField = toFieldErrors(body?.error.details);
        // 「現在のパスワードが違う」は項目別の形では返らないので、ここで欄に結び付ける
        // パスキーのときは今のパスワードの欄が無いので、上にまとめて出す（欄に付けると何も見えない）
        if (body?.error.code === "invalid_credentials" && !withPasskey) {
          byField.currentPassword = [body.error.message];
        }
        setFieldErrors(byField);
        // 欄の下に出せたものを上にも重ねない。同じ文が2つ並ぶと、別々の誤りに見える
        setError(
          Object.keys(byField).length > 0
            ? null
            : summaryError(
                body?.error.details,
                body?.error.message ?? m.changePassword.failed(res.status),
              ),
        );
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-4 lg:p-6">
      <Card collapsible={false}>
        <CardHeader>
          <CardTitle>{m.changePassword.title}</CardTitle>
          <CardDescription>
            {expired ? m.changePassword.expiredDescription : m.changePassword.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>{m.changePassword.done}</AlertDescription>
              </Alert>
              <Button className="w-full" onClick={() => router.push("/")}>
                {m.changePassword.toHome}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {withPasskey ? (
                <div className="space-y-2">
                  <p className="text-sm">{m.changePassword.passkeyNote}</p>
                  <button
                    type="button"
                    className="text-primary text-xs underline underline-offset-2"
                    onClick={() => {
                      setWithPasskey(false);
                      setNotice(null);
                    }}
                  >
                    {m.changePassword.usePassword}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="current">{m.changePassword.current}</Label>
                  <Input
                    id="current"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      clearField("currentPassword");
                    }}
                    aria-invalid={Boolean(fieldError("currentPassword"))}
                  />
                  <FieldError message={fieldError("currentPassword")} />
                  {passkey && (
                    <button
                      type="button"
                      className="text-primary text-xs underline underline-offset-2"
                      onClick={() => {
                        setWithPasskey(true);
                        clearField("currentPassword");
                      }}
                    >
                      {m.changePassword.usePasskey}
                    </button>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="next">{m.changePassword.next}</Label>
                <Input
                  id="next"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    clearField("newPassword");
                  }}
                  aria-invalid={Boolean(pwProblem ?? fieldError("newPassword"))}
                />
                <FieldError message={pwProblem ?? fieldError("newPassword")} />
                <p className="text-muted-foreground text-xs">{describePasswordPolicy(m, policy)}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{m.changePassword.confirm}</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    clearField("confirmPassword");
                  }}
                  aria-invalid={Boolean(mismatch ?? fieldError("confirmPassword"))}
                />
                <FieldError message={mismatch ?? fieldError("confirmPassword")} />
              </div>
              {notice && (
                <Alert>
                  <AlertDescription>{notice}</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading
                  ? withPasskey
                    ? m.passkey.waitingShort
                    : m.changePassword.submitting
                  : withPasskey
                    ? m.changePassword.submitWithPasskey
                    : m.changePassword.submit}
              </Button>
              {loading && withPasskey && (
                <p className="text-muted-foreground text-xs">{m.passkey.waiting}</p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
