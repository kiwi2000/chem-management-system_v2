"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FieldError } from "@/components/field-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n-client";
import { passwordProblem } from "@/lib/password-check";
import { usePasswordPolicy } from "@/lib/use-password-policy";
import type { ApiError } from "@/lib/types";

/** パスワード変更。初期パスワードでログインした直後はここへ誘導される */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { m } = useI18n();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const policy = usePasswordPolicy();
  // 打っている最中から決まりを見る。確認欄は、打ち終わるまで食い違いを責めない
  const pwProblem = passwordProblem(newPassword, m, policy);
  const mismatch =
    confirmPassword !== "" && confirmPassword !== newPassword
      ? m.validation.passwordMismatch
      : null;
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.changePassword.failed(res.status));
        return;
      }
      setDone(true);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>{m.changePassword.title}</CardTitle>
          <CardDescription>{m.changePassword.description}</CardDescription>
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
              <div className="space-y-2">
                <Label htmlFor="current">{m.changePassword.current}</Label>
                <Input
                  id="current"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="next">{m.changePassword.next}</Label>
                <Input
                  id="next"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  aria-invalid={Boolean(pwProblem)}
                />
                <FieldError message={pwProblem ?? undefined} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">{m.changePassword.confirm}</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={Boolean(mismatch)}
                />
                <FieldError message={mismatch ?? undefined} />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? m.changePassword.submitting : m.changePassword.submit}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
