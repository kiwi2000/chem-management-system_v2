import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { headers } from "next/headers";
import { writeAudit } from "@/lib/audit";
import { createSession, isAdminUser, purgeExpiredSessions } from "@/lib/auth";
import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { getAppSettings } from "@/lib/settings";
import { clientIp } from "@/lib/ip-allow";
import { expectedOrigin, keepChallenge, rpId, takeChallenge } from "@/lib/passkey";
import { syncPreferenceCookies } from "@/lib/preference-cookies";

export const dynamic = "force-dynamic";

/**
 * パスキーでログインする。
 *
 * **メールアドレスもパスワードも聞かない。**端末が「誰の鍵か」を覚えていて、
 * 指紋やPINで本人だと確かめたうえで署名を返す。
 * 鍵は登録したドメインに縛られているので、偽のログイン画面では署名が出ない。
 *
 * 認証を通さないルート（`authz-coverage.test.ts` の allowlist に入っている）。
 * ログインそのものなので、認証の前に呼ばれる。
 */

/** POST /api/auth/passkey/login — 端末に渡すお題を作る */
export async function POST() {
  const options = await generateAuthenticationOptions({
    rpID: await rpId(),
    /*
      **どの鍵を使うかは指定しない。**端末が持っているものから選ばせる。
      ここで候補を並べると、そのアドレスに鍵があることを外へ教えてしまう
    */
    userVerification: "required",
  });
  await keepChallenge("login", options.challenge);
  return Response.json(options);
}

/** PUT /api/auth/passkey/login — 署名を確かめてセッションを作る */
export async function PUT(req: Request) {
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const response = (body ?? {}) as AuthenticationResponseJSON;
  if (typeof response.id !== "string") {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const challenge = await takeChallenge("login");
  if (!challenge) return jsonError(400, "challenge_expired", m.passkey.expired);

  const stored = await prisma.passkey.findUnique({
    where: { credentialId: response.id },
    include: { user: true },
  });
  /*
    **見つからないときも、合わないときと同じ返しにする。**
    分けると、その鍵が登録されているかどうかを外から試せてしまう
  */
  if (!stored) return jsonError(401, "invalid_credentials", m.errors.invalidCredentials);

  const user = stored.user;
  if (user.deletedAt || !user.activeFlag) {
    // 止められているアカウントも、ただの「合いません」で返す（パスワードのときと同じ）
    return jsonError(401, "invalid_credentials", m.errors.invalidCredentials);
  }
  // メンテナンス中は管理者しか入れない
  if ((await getAppSettings()).maintenanceMode && !(await isAdminUser(user.id))) {
    return jsonError(403, "maintenance", m.errors.maintenance);
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: await expectedOrigin(),
      expectedRPID: await rpId(),
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: Number(stored.counter),
        transports: stored.transports
          ? (stored.transports.split(",") as ("usb" | "nfc" | "ble" | "internal" | "hybrid")[])
          : undefined,
      },
    });
  } catch {
    return jsonError(401, "invalid_credentials", m.errors.invalidCredentials);
  }
  if (!verification.verified) {
    return jsonError(401, "invalid_credentials", m.errors.invalidCredentials);
  }

  await prisma.passkey.update({
    where: { id: stored.id },
    data: {
      counter: BigInt(verification.authenticationInfo.newCounter),
      lastUsedAt: new Date(),
    },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id);

  void purgeExpiredSessions();
  await syncPreferenceCookies(user);

  const hdrs = await headers();
  await writeAudit({
    entity: "users",
    entityId: user.id,
    action: "login",
    actorId: user.id,
    diff: {
      email: user.email,
      // どうやって入ったかを残す。パスキーとパスワードを見分けられるように
      method: "passkey",
      deviceLabel: stored.deviceLabel,
      ip: clientIp(hdrs.get("x-forwarded-for")),
      userAgent: hdrs.get("user-agent")?.slice(0, 200) ?? null,
    },
  });
  return Response.json({ ok: true, mustChangePassword: user.mustChangePassword });
}
