import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import {
  keepChallenge,
  passkeysOf,
  RP_NAME,
  expectedOrigin,
  rpId,
  takeChallenge,
} from "@/lib/passkey";

export const dynamic = "force-dynamic";

/**
 * 自分のパスキーを登録する。
 *
 * 手順を2つに分けている。
 *   POST … 使い捨ての文字列を作って端末に渡す（まだ登録しない）
 *   PUT  … 端末が返した署名を確かめて、そこで初めて登録する
 *
 * 認証アプリの登録と同じ考え方で、**確かめられてから登録する。**
 */

/** POST /api/auth/passkey/register — 端末に渡すお題を作る */
export async function POST() {
  // 用事そのもの（2要素認証の登録）
  const auth = await requireUser({ allowPending: true });
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const existing = await passkeysOf(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: await rpId(),
    userName: user.email,
    userDisplayName: user.displayName ?? user.email,
    // 同じ端末を二重に登録させない。端末側が「もう登録済みです」と教えてくれる
    excludeCredentials: existing.map((p) => ({ id: p.credentialId })),
    authenticatorSelection: {
      /*
        **端末の中に鍵を持たせる。**こうするとログインのときに
        メールアドレスを打たずに済む（端末が誰の鍵かを覚えている）。
      */
      residentKey: "required",
      /*
        **指紋・顔・PINでの本人確認を必須にする。**
        これがないと「端末を持っている」だけになり、要素が1つに戻ってしまう
      */
      userVerification: "required",
    },
  });

  await keepChallenge("register", options.challenge);
  return Response.json(options);
}

/** PUT /api/auth/passkey/register — 端末が返した署名を確かめて登録する */
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
  const { response, deviceLabel } = (body ?? {}) as {
    response?: RegistrationResponseJSON;
    deviceLabel?: unknown;
  };
  const label = typeof deviceLabel === "string" ? deviceLabel.trim() : "";
  if (!response || label === "" || label.length > 60) {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const challenge = await takeChallenge("register");
  if (!challenge) return jsonError(400, "challenge_expired", m.passkey.expired);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: await expectedOrigin(),
      expectedRPID: await rpId(),
      requireUserVerification: true,
    });
  } catch {
    return jsonError(400, "passkey_invalid", m.passkey.failed);
  }
  if (!verification.verified || !verification.registrationInfo) {
    return jsonError(400, "passkey_invalid", m.passkey.failed);
  }

  const { credential } = verification.registrationInfo;
  // 同じ鍵が既にあれば、二重に足さない（端末が excludeCredentials を無視した場合）
  if (await prisma.passkey.findUnique({ where: { credentialId: credential.id } })) {
    return jsonError(409, "already_registered", m.passkey.alreadyRegistered);
  }

  await prisma.passkey.create({
    data: {
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: BigInt(credential.counter),
      transports: credential.transports?.join(",") ?? null,
      deviceLabel: label,
    },
  });

  // 入口の守りが変わった瞬間。身に覚えのない登録に気づけるようにする
  await writeAudit({
    entity: "users",
    entityId: user.id,
    action: "passkey_add",
    actorId: user.id,
    diff: { deviceLabel: label },
  });
  return Response.json({ ok: true });
}
