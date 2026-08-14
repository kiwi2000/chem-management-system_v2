import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShellClient } from "@/components/app-shell-client";
import { canEdit, getActor } from "@/lib/authz";
import { EXPIRED_LOGIN_URL, PATH_HEADER, PUBLIC_PATHS } from "@/lib/routes";

/**
 * アプリシェル。
 * セッションと権限の取得（サーバー側）だけをここで行い、見た目と開閉はクライアント側に渡す。
 *
 * middleware は Cookie の有無しか見られないので、
 * 「Cookie は残っているがセッションは無効」（管理者による無効化・権限変更・期限切れ）は
 * ここで初めて分かる。その場合はログイン画面へ送り返す。
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const actor = await getActor();

  if (!actor) {
    const path = (await headers()).get(PATH_HEADER) ?? "";
    if (!PUBLIC_PATHS.some((p) => path.startsWith(p))) {
      redirect(EXPIRED_LOGIN_URL);
    }
    // ログイン画面などはシェル無しで中身だけ出す
    return <>{children}</>;
  }

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
