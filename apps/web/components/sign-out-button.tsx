"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";

export function SignOutButton() {
  const router = useRouter();
  const { m } = useI18n();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
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
