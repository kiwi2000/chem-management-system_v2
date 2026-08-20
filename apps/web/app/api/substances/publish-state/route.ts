import { publishActionSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { canEditSubstance, visibilityWhere } from "@/lib/substance-service";
import {
  checkTransition,
  denialError,
  nextStateOf,
  publishedParentsOf,
  writeApprovalEvent,
  type TransitionDenial,
} from "@/lib/publish-service";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/substances/publish-state — 公開の状態を変える。
 *
 * 保存（PUT）ではこの状態を動かさず、この操作でだけ変える。
 * 「とりあえず保存しておく」と「他の人に使わせてよい」を、操作として分けるため。
 * 一覧からまとめて申請・承認できるよう、複数の ID を受け取る。
 */
export async function POST(req: Request) {
  const m = await getServerMessages();
  const actor = await requirePermission("SUBSTANCE_VIEW");
  if (actor instanceof Response) return actor;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = publishActionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { ids, action, comment } = parsed.data;
  const settings = await getAppSettings();

  // 見えないものは対象にしない
  const targets = await prisma.substance.findMany({
    where: { id: { in: ids }, deletedAt: null, ...visibilityWhere(actor) },
    select: { id: true, code: true, publishState: true, createdBy: true },
  });

  const allowed: typeof targets = [];
  const blocked: string[] = [];
  const denials: TransitionDenial[] = [];
  for (const t of targets) {
    const err = checkTransition({
      action,
      from: t.publishState,
      approvalRequired: settings.substanceApprovalRequired,
      actor,
      canEdit: canEditSubstance(actor, { ...t, publishState: "DRAFT" }),
      m,
    });
    if (err) {
      denials.push(err);
      continue;
    }
    // 公開を取り消すときだけ、公開済の組成から参照されていないか確かめる
    if (action === "unpublish") {
      const parents = await publishedParentsOf("substance", t.id);
      if (parents.length > 0) {
        blocked.push(`${t.code}（${parents.join(", ")}）`);
        continue;
      }
    }
    allowed.push(t);
  }

  if (allowed.length === 0) {
    if (blocked.length > 0) {
      return jsonError(409, "referenced", m.errors.usedByPublished(blocked.join(" / ")));
    }
    return denialError(denials, m);
  }

  const next = nextStateOf(action);
  await prisma.substance.updateMany({
    where: { id: { in: allowed.map((t) => t.id) } },
    data: { publishState: next, updatedBy: actor.user.id },
  });

  for (const t of allowed) {
    await writeApprovalEvent({
      entity: "substance",
      entityId: t.id,
      action,
      actorId: actor.user.id,
      comment,
    });
    await writeAudit({
      entity: "substances",
      entityId: t.id,
      action: "update",
      actorId: actor.user.id,
      diff: { code: t.code, publishState: next },
    });
  }

  return Response.json({
    ok: true,
    updated: allowed.length,
    requested: ids.length,
    blocked,
  });
}
