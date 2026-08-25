import { writeAudit } from "@/lib/audit";
import { generateTotpSecret, totpUri, verifyTotp } from "@/lib/totp";
import { revokeAllSessions, createSession, verifyPassword } from "@/lib/auth";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * 自分の2要素認証。
 *
 * 手順を2つに分けている。
 *   POST … 鍵を作って渡す（まだ有効にしない）
 *   PUT  … 認証アプリが出した6桁が合っていたら、そこで初めて有効にする
 *
 * 一度で有効にすると、読み取りに失敗した人が自分の口座から締め出される。
 * 「6桁が出せること」を確かめてから切り替える。
 */

/** GET /api/auth/mfa — いまの状態 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const settings = await getAppSettings();
  return Response.json({
    method: auth.user.mfaMethod,
    required: settings.mfaRequired,
    // 鍵はあるが有効になっていない＝登録の途中
    pending: auth.user.mfaMethod === "none" && auth.user.mfaSecret !== null,
  });
}

/** POST /api/auth/mfa — 鍵を作る。まだ有効にはしない */
export async function POST() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const m = await getServerMessages();

  if (user.mfaMethod === "totp") {
    return jsonError(409, "already_enabled", m.mfa.alreadyEnabled);
  }

  // 押し直すたびに作り直す。前の鍵で読み取り済みの端末は使えなくなるが、
  // まだ有効にしていないので実害は無い
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret } });

  return Response.json({ secret, uri: totpUri(secret, user.email) });
}

/** PUT /api/auth/mfa — 6桁を確かめて有効にする */
export async function PUT(req: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const totp = (body as { totp?: unknown }).totp;
  if (typeof totp !== "string" || !/^\d{6}$/.test(totp.trim())) {
    return jsonError(400, "validation_error", m.mfa.codeFormat);
  }
  if (!user.mfaSecret) {
    return jsonError(409, "no_secret", m.mfa.noSecret);
  }
  if (!verifyTotp(user.mfaSecret, totp)) {
    return jsonError(400, "mfa_invalid", m.mfa.codeWrong);
  }

  await prisma.user.update({ where: { id: user.id }, data: { mfaMethod: "totp" } });
  await writeAudit({
    entity: "users",
    entityId: user.id,
    action: "update",
    actorId: user.id,
    diff: { mfaMethod: "totp" },
  });
  return Response.json({ ok: true });
}

/**
 * DELETE /api/auth/mfa — 自分で解除する。
 * 守りを1枚外す操作なので、パスワードをもう一度確かめる。
 */
export async function DELETE(req: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;
  const m = await getServerMessages();

  const settings = await getAppSettings();
  if (settings.mfaRequired) {
    return jsonError(409, "mfa_required", m.mfa.cannotDisable);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const password = (body as { password?: unknown }).password;
  if (typeof password !== "string" || password === "") {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    return jsonError(401, "invalid_credentials", m.errors.currentPasswordWrong);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mfaMethod: "none", mfaSecret: null },
  });
  // 守りを外したので、他の端末は入り直してもらう
  await revokeAllSessions(user.id);
  await createSession(user.id);

  await writeAudit({
    entity: "users",
    entityId: user.id,
    action: "update",
    actorId: user.id,
    diff: { mfaMethod: "none" },
  });
  return Response.json({ ok: true });
}
