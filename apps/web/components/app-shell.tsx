import type { ReactNode } from "react";
import { AppShellClient } from "@/components/app-shell-client";
import { canEdit, getActor } from "@/lib/authz";

/**
 * アプリシェル。
 * セッションと権限の取得（サーバー側）だけをここで行い、見た目と開閉はクライアント側に渡す。
 * 未ログイン時（ログイン画面など）はそのまま中身だけを描画する。
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) return <>{children}</>;

  return (
    <AppShellClient
      user={{
        email: actor.user.email,
        displayName: actor.user.displayName,
        permissions: actor.permissions,
        canEdit: canEdit(actor),
        isAdmin: actor.has("ADMIN"),
      }}
    >
      {children}
    </AppShellClient>
  );
}
