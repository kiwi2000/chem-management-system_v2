import { ChangePasswordForm } from "@/components/change-password-form";
import { getActor } from "@/lib/authz";
import { hasPasskey } from "@/lib/passkey";
import { passwordExpired } from "@/lib/pending-step";
import { getAppSettings } from "@/lib/settings";

/**
 * パスワード変更。初期パスワードでログインした直後と、
 * 有効期限が切れた人（2026-09-17 指示）はここへ誘導される。
 *
 * **なぜ出ているのかはサーバー側で決める。**この画面に来ている人は
 * 他の画面を開けないので、画面の側から状態を問い合わせることができない
 */
export default async function ChangePasswordPage() {
  const actor = await getActor();
  const expired = actor ? passwordExpired(actor.user, await getAppSettings()) : false;
  // パスキーを登録している人には、今のパスワードの代わりにパスキーで確かめる道を出す
  const passkey = actor ? await hasPasskey(actor.user.id) : false;
  return <ChangePasswordForm expired={expired} passkey={passkey} />;
}
