import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { clearHeaderIcon, saveHeaderIcon } from "@/lib/header-icon";
import { getServerMessages } from "@/lib/i18n";
import { IMAGE_INPUT_MIMES, IMAGE_UPLOAD_MAX, processImage } from "@/lib/image-process";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * 題字の横のアイコンは帯の高さ（36px）に縮めて出すので、これだけあれば高精細の画面でも足りる
 * （横長 4:1 のロゴでも高さ 128px が残る）。
 * 画像ライブラリの上限（既定 2000px）をそのまま使うと、設定の行が無駄に太る
 */
const ICON_MAX_EDGE = 512;

/**
 * POST /api/settings/app-icon — アイコンを預ける（multipart の `file`。システム管理者のみ）。
 * 画像ライブラリと同じ整えかた（形式・画質はシステム設定のとおり、長辺だけ小さく）で入れ、
 * 預けた時刻を返す。画面はそれを URL に付けて出す
 */
export async function POST(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form", m.errors.validation);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "no_file", m.errors.validation);
  if (file.size > IMAGE_UPLOAD_MAX) return jsonError(400, "too_large", m.images.rejectTooLarge);
  if (file.type && !IMAGE_INPUT_MIMES.has(file.type)) {
    return jsonError(400, "not_image", m.images.rejectNotImage);
  }

  const settings = await getAppSettings();
  let out;
  try {
    out = await processImage(Buffer.from(await file.arrayBuffer()), {
      imageMaxEdgePx: ICON_MAX_EDGE,
      imageFormat: settings.imageFormat,
      imageJpegQuality: settings.imageJpegQuality,
    });
  } catch {
    return jsonError(400, "not_image", m.images.rejectNotImage);
  }
  const version = await saveHeaderIcon({ mime: out.mime, bytes: out.data }, actor.user.id);
  await writeAudit({
    entity: "system_settings",
    action: "update",
    actorId: actor.user.id,
    diff: { headerIcon: { name: file.name, mime: out.mime, width: out.width, height: out.height } },
  });
  return Response.json({ version });
}

/** DELETE /api/settings/app-icon — アイコンを外す（システム管理者のみ） */
export async function DELETE() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  await clearHeaderIcon(actor.user.id);
  await writeAudit({
    entity: "system_settings",
    action: "update",
    actorId: actor.user.id,
    diff: { headerIcon: null },
  });
  return Response.json({ ok: true });
}
