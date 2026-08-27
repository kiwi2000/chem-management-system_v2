"use client";

import { MfaSection } from "@/components/mfa-section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "@/lib/i18n-client";

/**
 * 2要素認証の登録。
 *
 * **必須にしてあるのに、まだ登録していない人だけがここへ送られる。**
 * 登録が済むまで他の画面は開かない（`components/app-shell.tsx`）。
 *
 * 中身は自分の設定画面と同じものを使う。別に作ると、片方だけ直したときに
 * 手順が食い違う。
 */
export default function MfaSetupPage() {
  const { m } = useI18n();

  return (
    <div className="mx-auto max-w-xl space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{m.mfaSetup.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{m.mfaSetup.lead}</p>
      </div>
      {/* なぜ止められているのかを先に伝える。分からないまま進ませない */}
      <Alert>
        <AlertDescription>{m.mfaSetup.why}</AlertDescription>
      </Alert>
      <MfaSection />
    </div>
  );
}
