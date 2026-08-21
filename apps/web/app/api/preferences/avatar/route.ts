import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * 受け取れる大きさの上限。画面側で 256px 四方に縮めてから送るので、
 * これを超えるものは縮小をすり抜けてきたものとみなす。
 */
const MAX_BYTES = 512 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/**
 * PUT /api/preferences/avatar — 自分のアバターを差し替える。
 * 本文は画像そのもの。種類は Content-Type で受ける。
 *
 * 自分の分だけを触るので、管理者の権限は要らない。
 */
export async function PUT(req: Request) {
  const m = await getServerMessages();
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const mime = (req.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!ALLOWED.includes(mime)) {
    return jsonError(400, "validation_error", m.preferences.avatarTypeError);
  }

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return jsonError(400, "validation_error", m.errors.validation);
  if (buf.length > MAX_BYTES) {
    return jsonError(400, "validation_error", m.preferences.avatarTooLarge);
  }

  await prisma.user.update({
    where: { id: actor.user.id },
    data: { avatarData: buf, avatarMime: mime, avatarUpdatedAt: new Date() },
  });
  return Response.json({ ok: true });
}

/** DELETE /api/preferences/avatar — 自分のアバターを外す */
export async function DELETE() {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  await prisma.user.update({
    where: { id: actor.user.id },
    data: { avatarData: null, avatarMime: null, avatarUpdatedAt: new Date() },
  });
  return Response.json({ ok: true });
}
