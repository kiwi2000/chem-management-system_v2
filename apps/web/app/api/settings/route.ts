import { settingsSaveSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAdmin } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";
import { countPending, resolvePending } from "@/lib/pending-resolution";
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
  const parsed = settingsSaveSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { pendingResolution, ...next } = parsed.data;

  /**
   * 承認を「必要 → 不要」に切り替えると、承認待ちのものを承認する人がいなくなる。
   * 宙に浮かせないよう、作成中に戻すか公開するかを選んでもらってから進める。
   */
  const before = await getAppSettings();
  const pending = await countPending();
  const needsChoice: Record<string, number> = {};
  for (const [entity, wasRequired, isRequired] of [
    ["substance", before.substanceApprovalRequired, next.substanceApprovalRequired],
    ["product", before.productApprovalRequired, next.productApprovalRequired],
  ] as const) {
    if (wasRequired && !isRequired && pending[entity] > 0 && !pendingResolution?.[entity]) {
      needsChoice[entity] = pending[entity];
    }
  }
  if (Object.keys(needsChoice).length > 0) {
    return jsonError(409, "pending_resolution_required", m.errors.pendingResolutionRequired, {
      pending: needsChoice,
    });
  }

  for (const entity of ["substance", "product"] as const) {
    const how = pendingResolution?.[entity];
    const wasRequired =
      entity === "substance" ? before.substanceApprovalRequired : before.productApprovalRequired;
    const isRequired =
      entity === "substance" ? next.substanceApprovalRequired : next.productApprovalRequired;
    if (how && wasRequired && !isRequired) {
      await resolvePending(entity, how, actor.user.id);
    }
  }

  await saveAppSettings(next, actor.user.id);
  await writeAudit({
    entity: "system_settings",
    action: "update",
    actorId: actor.user.id,
    diff: next,
  });
  return Response.json({ ok: true, settings: next });
}
