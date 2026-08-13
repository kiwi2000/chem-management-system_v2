import { settingsSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";
import { getAppSettings, saveAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings — 現在の設定（システム管理者のみ）。
 * 一般ユーザーの画面が設定を必要とする場合は、この API ではなく
 * サーバーコンポーネントから lib/settings.ts の getAppSettings() を呼んで値だけ渡すこと。
 */
export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  return Response.json({ settings: await getAppSettings() });
}

/** PUT /api/settings — 設定の変更（システム管理者のみ） */
export async function PUT(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = settingsSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }

  await saveAppSettings(parsed.data, actor.user.id);
  await writeAudit({
    entity: "system_settings",
    action: "update",
    actorId: actor.user.id,
    diff: parsed.data,
  });
  return Response.json({ ok: true, settings: parsed.data });
}
