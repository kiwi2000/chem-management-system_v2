import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShellClient } from "@/components/app-shell-client";
import { canEdit, getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPasskey } from "@/lib/passkey";
import { PENDING_PATH, pendingStep } from "@/lib/pending-step";
import { EXPIRED_LOGIN_URL, PATH_HEADER, PUBLIC_PATHS } from "@/lib/routes";
import { getAppSettings } from "@/lib/settings";

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
  const path = (await headers()).get(PATH_HEADER) ?? "";

  if (!actor) {
    if (!PUBLIC_PATHS.some((p) => path.startsWith(p))) {
      redirect(EXPIRED_LOGIN_URL);
    }
    // ログイン画面などはシェル無しで中身だけ出す
    return <>{children}</>;
  }

  /*
    済ませていない用事があるなら、その画面から動かさない。
    ログイン直後に送るだけでは、URL を直に打てば素通りできてしまう。

    **枠は出したまま。**ログアウトの口を消すと、途中でやめられなくなる
  */
  const step = pendingStep(
    { ...actor.user, hasPasskey: await hasPasskey(actor.user.id) },
    await getAppSettings(),
  );
  if (step && path !== PENDING_PATH[step]) {
    redirect(PENDING_PATH[step]);
  }

  /*
    いま判定に使っている法規制のバージョン。**どのバージョンで判定したかが分からないと、
    出た結果を人に見せられない。**左ペインの下に出す
  */
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { code: true, nameJa: true },
  });

  return (
    <AppShellClient
      version={version ? { code: version.code, nameJa: version.nameJa } : null}
      user={{
        id: actor.user.id,
        email: actor.user.email,
        displayName: actor.user.displayName,
        permissions: actor.permissions,
        canEdit: canEdit(actor),
        isAdmin: actor.has("ADMIN"),
      }}
      // アバターを差し替えても、URLが同じだとブラウザが古い絵を出し続ける。
      // 更新日時をURLに乗せて、変わったときだけ取り直させる
      avatarVersion={actor.user.avatarUpdatedAt?.getTime() ?? 0}
    >
      {children}
    </AppShellClient>
  );
}
