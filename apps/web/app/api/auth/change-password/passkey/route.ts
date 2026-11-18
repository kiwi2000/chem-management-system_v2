import { passkeyPasswordSchema, pickPasswordPolicy } from "@chem/shared";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { writeAudit } from "@/lib/audit";
import { createSession, hashPassword, revokeAllSessions, verifyPassword } from "@/lib/auth";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { expectedOrigin, keepChallenge, passkeysOf, rpId, takeChallenge } from "@/lib/passkey";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * パスキーで本人と確かめて、**今のパスワード無しで**パスワードを作り直す（2026-11-18 指示）。
 *
 * パスワードを忘れた人は、管理者に発行し直してもらうしかなかった。パスキーは
 * 端末を持っていることと指紋・顔・PIN の 2 つを満たすので、今のパスワードを入れるより強い確かめ方になる。
 *
 * **ログインしているだけでは変えさせない。**変える直前に、その場でもう一度パスキーで確かめる
 * （席を離れた画面を使われても変えられない）。確かめに使う鍵は、**ログインしている本人の鍵**に限る。
 *
 *   POST … 端末に渡すお題を作る（本人の鍵だけを候補にする）
 *   PUT  … 署名と新しいパスワードを受け取り、確かめてから変える
 */

const transportsOf = (raw: string | null) =>
  raw ? (raw.split(",") as AuthenticatorTransportFuture[]) : undefined;

/** POST /api/auth/change-password/passkey — 端末に渡すお題を作る */
export async function POST() {
  // 用事そのもの（初期パスワード・期限切れのパスワードの変更）
  const auth = await requireUser({ allowPending: true });
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const m = await getServerMessages();

  const keys = await passkeysOf(user.id);
  if (keys.length === 0) return jsonError(400, "no_passkey", m.changePassword.noPasskey);

  const options = await generateAuthenticationOptions({
    rpID: await rpId(),
    // ログインのときと違い、本人の鍵だけを候補に出す（もうだれかは分かっている）
    allowCredentials: keys.map((k) => ({
      id: k.credentialId,
      transports: transportsOf(k.transports),
    })),
    userVerification: "required",
  });
  await keepChallenge("reauth", options.challenge);
  return Response.json(options);
}

/** PUT /api/auth/change-password/passkey — 署名を確かめてパスワードを変える */
export async function PUT(req: Request) {
  const auth = await requireUser({ allowPending: true });
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const { response, ...passwords } = (body ?? {}) as {
    response?: AuthenticationResponseJSON;
    newPassword?: unknown;
    confirmPassword?: unknown;
  };
  const parsed = passkeyPasswordSchema(m, pickPasswordPolicy(await getAppSettings())).safeParse(
    passwords,
  );
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  if (typeof response?.id !== "string") {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  const { newPassword } = parsed.data;

  const challenge = await takeChallenge("reauth");
  if (!challenge) return jsonError(400, "challenge_expired", m.passkey.expired);

  const stored = await prisma.passkey.findUnique({ where: { credentialId: response.id } });
  // ほかの人の鍵で確かめても通さない（同じ端末に 2 人分の鍵があることもある）
  if (!stored || stored.userId !== user.id) {
    return jsonError(401, "passkey_not_yours", m.changePassword.passkeyNotYours);
  }

  let verified = false;
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: await expectedOrigin(),
      expectedRPID: await rpId(),
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: Number(stored.counter),
        transports: transportsOf(stored.transports),
      },
    });
    verified = verification.verified;
    if (verified) {
      await prisma.passkey.update({
        where: { id: stored.id },
        data: {
          counter: BigInt(verification.authenticationInfo.newCounter),
          lastUsedAt: new Date(),
        },
      });
    }
  } catch {
    verified = false;
  }
  if (!verified) return jsonError(401, "invalid_credentials", m.passkey.failed);

  /*
    **今と同じかは、本人と確かめたあとに見る。**先に見ると、ログインしたままの画面から
    「この文字列は今のパスワードか」を何回でも試せてしまう（ロックも掛からない）
  */
  if (user.passwordHash && (await verifyPassword(user.passwordHash, newPassword))) {
    return jsonError(400, "validation_error", m.errors.validation, {
      formErrors: [],
      fieldErrors: { newPassword: [m.validation.passwordSameAsCurrent] },
    });
  }

  // ここから先は、今のパスワードで変えるとき（../route.ts）と同じ
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    },
  });
  await revokeAllSessions(user.id); // 全端末を強制ログアウト
  await createSession(user.id); // 自分は継続

  await writeAudit({
    entity: "users",
    entityId: user.id,
    action: "update",
    actorId: user.id,
    // 今のパスワードではなくパスキーで確かめて変えたことを残す
    diff: { passwordChanged: true, method: "passkey", deviceLabel: stored.deviceLabel },
  });
  return Response.json({ ok: true });
}
