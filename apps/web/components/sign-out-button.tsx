"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";

export function SignOutButton() {
  const { m } = useI18n();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      // ログインと同じ理由で、読み込み直す。
      // replace なのは、戻るボタンで中の画面に戻らせないため
      window.location.replace("/login");
    } finally {
      setBusy(false);
    }
  }

  return (
    // 背景を持つボタンなので、濃いヘッダーでも文字色は本文色に固定する
    <Button
      variant="outline"
      size="sm"
      className="text-foreground"
      onClick={() => void signOut()}
      disabled={busy}
    >
      {busy ? m.common.processing : m.shell.signOut}
    </Button>
  );
}
