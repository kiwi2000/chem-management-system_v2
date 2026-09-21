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
    /* 帯の上でも、ほかの角丸四角形のボタンと同じ塗り（globals.css の outline の塗り。2026-09-22 指示） */
    <Button variant="outline" size="sm" onClick={() => void signOut()} disabled={busy}>
      {busy ? m.common.processing : m.shell.signOut}
    </Button>
  );
}
