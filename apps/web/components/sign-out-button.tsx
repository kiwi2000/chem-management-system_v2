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
    /*
      帯の上に置く塗りのあるボタン。濃い帯では帯の色を少し混ぜた白になる（globals.css の --header-button）。
      outline の既定は暗い配色で `dark:bg-input/30` を当てるので、暗い配色でも同じ塗りになるよう
      dark: の側でも上書きする（放っておくと暗い塗りに暗い字が乗って読めなかった）
    */
    <Button
      variant="outline"
      size="sm"
      className="bg-header-button text-header-button-foreground border-header-button-border hover:bg-header-button hover:text-header-button-foreground hover:brightness-95 dark:bg-header-button dark:border-header-button-border dark:hover:bg-header-button"
      onClick={() => void signOut()}
      disabled={busy}
    >
      {busy ? m.common.processing : m.shell.signOut}
    </Button>
  );
}
