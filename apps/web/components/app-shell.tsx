import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShellClient } from "@/components/app-shell-client";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { HardRedirect } from "@/components/hard-redirect";
import { canEdit, getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { hasPasskey } from "@/lib/passkey";
import { PENDING_PATH, passwordExpiryWarningDays, pendingStep } from "@/lib/pending-step";
import { EXPIRED_LOGIN_URL, PATH_HEADER, PUBLIC_PATHS } from "@/lib/routes";
import { getAppSettings } from "@/lib/settings";

/**
 * アプリシェル。
 * セッションと権限の取得（サーバー側）だけをここで行い、見た目と開閉はクライアント側に渡す。
 *
 * proxy（入口）は Cookie の有無しか見られないので、
 * 「Cookie は残っているがセッションは無効」（管理者による無効化・権限変更・期限切れ）は
 * ここで初めて分かる。その場合はログイン画面へ送り返す。
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const actor = await getActor();
  const hdrs = await headers();
  const path = hdrs.get(PATH_HEADER) ?? "";
  /*
    別の画面へ送る。**ここ（最上位の layout の中）では、画面ごとの読み込みのときだけ `redirect()` を使う。**
    画面の中からの読み込み（移動・`router.refresh()`）で layout が `redirect()` を投げると、送り先を休みなく取りに行く
    （components/hard-redirect.tsx）。ブラウザが付ける `Sec-Fetch-Dest` が document のときだけが、画面ごとの読み込み。
    それ以外と、付いていないときは、画面ごと読み込み直して送る
  */
  const leave = (to: string) => {
    if (hdrs.get("sec-fetch-dest") === "document") redirect(to);
    return <HardRedirect to={to} />;
  };

  if (!actor) {
    if (!PUBLIC_PATHS.some((p) => path.startsWith(p))) {
      return leave(EXPIRED_LOGIN_URL);
    }
    // ログイン画面などはシェル無しで中身だけ出す
    return <>{children}</>;
  }

  /*
    済ませていない用事があるなら、その画面から動かさない。
    ログイン直後に送るだけでは、URL を直に打てば素通りできてしまう。

    **枠は出したまま。**ログアウトの口を消すと、途中でやめられなくなる

    layout は、画面の中の移動（メニューを押すなど）では作り直されない。ここの判定だけだと、
    用事の画面からメニューを押した人に、中身の読めない一覧が開いてしまう（2026-11-17、本番で起きた）。
    枠の側（AppShellClient）に用事の画面を渡し、ほかの画面へ移ろうとしたら読み込み直させる
  */
  const settings = await getAppSettings();
  const step = pendingStep(
    { ...actor.user, hasPasskey: await hasPasskey(actor.user.id) },
    settings,
  );
  if (step && path !== PENDING_PATH[step]) {
    return leave(PENDING_PATH[step]);
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
    // 「消しますか」の窓。どの画面からでも同じ窓で聞けるよう、外枠で1つだけ持つ
    <ConfirmProvider>
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
        // 済ませていない用事の画面。枠はこれを見て、ほかの画面へ移ろうとしたら読み込み直す（下の注釈）
        pendingPath={step ? PENDING_PATH[step] : null}
        // パスワードの期限が近いときの予告（2026-09-17 指示）。出さないときは null
        passwordExpiresIn={passwordExpiryWarningDays(actor.user, settings)}
        // 題字の横のアイコン（2026-09-25 指示）。預けていなければ null
        headerIcon={
          settings.headerIconVersion
            ? {
                version: settings.headerIconVersion,
                position: settings.headerIconPosition,
                hideName: settings.headerHideName,
              }
            : null
        }
      >
        {children}
      </AppShellClient>
    </ConfirmProvider>
  );
}
