import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";

/**
 * パスキー（WebAuthn）の下ごしらえ。
 *
 * **外へ一切出さない。**鍵の検証は手元の計算だけで済む
 * （`@simplewebauthn/server` は解析と署名検証の道具で、通信はしない）。
 *
 * **端末との往復は2回。**こちらが使い捨ての文字列を出し、
 * 端末がそれに署名して返す。その文字列を覚えておく場所が要る。
 * 保存先は Cookie にしてある。ログインのときはまだセッションが無く、
 * データベースに置くと入る前の人のぶんが溜まり続けるため。
 */

/** 使い捨ての文字列を置く Cookie。登録用とログイン用で分ける */
const REGISTER_COOKIE = "chem_passkey_reg";
const LOGIN_COOKIE = "chem_passkey_login";

/** 端末の操作が終わるまでの猶予。長く残しても使い道が無い */
const CHALLENGE_SECONDS = 300;

/**
 * 鍵を縛るドメイン。
 *
 * **登録したドメインでしか使えない。**これが偽サイト対策の要なので、
 * 環境変数などで上書きできるようにはしない。要求が来たホストをそのまま使う。
 * 接続口の番号は含めない（`localhost:3001` ではなく `localhost`）。
 */
export async function rpId(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  return host.split(":")[0] ?? "localhost";
}

/** 署名を確かめるときに突き合わせる、画面の出どころ */
export async function expectedOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  // 手元の開発だけ http。それ以外は https（本番は必ず https）
  const proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${proto}://${host}`;
}

/** 見せる名前。認証アプリの一覧に出る */
export const RP_NAME = "化学物質管理システム";

type Kind = "register" | "login";
const cookieName = (kind: Kind) => (kind === "register" ? REGISTER_COOKIE : LOGIN_COOKIE);

/** 使い捨ての文字列を覚えておく */
export async function keepChallenge(kind: Kind, challenge: string): Promise<void> {
  const jar = await cookies();
  jar.set(cookieName(kind), challenge, {
    httpOnly: true,
    sameSite: "lax",
    // 手元の開発は http なので、そこだけ secure を外す
    secure: (await expectedOrigin()).startsWith("https"),
    path: "/",
    maxAge: CHALLENGE_SECONDS,
  });
}

/**
 * 覚えておいた文字列を取り出して、**その場で消す。**
 * 残しておくと同じものを二度使えてしまう
 */
export async function takeChallenge(kind: Kind): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(cookieName(kind))?.value ?? null;
  if (v) jar.delete(cookieName(kind));
  return v;
}

/** その人が登録している端末（新しいものから） */
export async function passkeysOf(userId: string) {
  return prisma.passkey.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * パスキーを登録しているか。
 * **2要素認証を済ませたかの判定に使う。**パスキーは端末を持っていることと、
 * 指紋やPINで本人だと確かめることの2つを、それだけで満たす
 */
export async function hasPasskey(userId: string): Promise<boolean> {
  return (await prisma.passkey.count({ where: { userId } })) > 0;
}
