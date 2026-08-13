"use client";

import { LOCALES, LOCALE_LABELS, type Locale } from "@chem/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n-client";

/**
 * 言語切替。
 * 選ぶと Cookie（とログイン中なら自分の設定）を更新し、サーバー側で描画し直す。
 */
export function LanguageSwitcher() {
  const { locale, m } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(next: Locale) {
    if (next === locale) return;
    setBusy(true);
    try {
      await fetch("/api/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      aria-label={m.shell.language}
      value={locale}
      disabled={busy}
      onChange={(e) => void change(e.target.value as Locale)}
      className="border-input bg-background h-8 rounded-md border px-2 text-sm"
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {LOCALE_LABELS[l]}
        </option>
      ))}
    </select>
  );
}
