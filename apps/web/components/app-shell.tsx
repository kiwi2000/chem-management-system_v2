import type { ReactNode } from "react";
import { AppShellClient } from "@/components/app-shell-client";
import { getSessionUser } from "@/lib/auth";
import { canEdit } from "@/lib/authz";

/**
 * アプリシェル。
 * セッションの取得（サーバー側）だけをここで行い、見た目と開閉はクライアント側に渡す。
 * 未ログイン時（ログイン画面など）はそのまま中身だけを描画する。
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  if (!user) return <>{children}</>;

  return (
    <AppShellClient
      user={{
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        canEdit: canEdit(user),
      }}
    >
      {children}
    </AppShellClient>
  );
}
