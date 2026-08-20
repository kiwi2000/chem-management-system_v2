import { jsonError, requireUser } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";
import { listApprovalEvents } from "@/lib/publish-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/approval-events?entity=product&entityId=...
 *
 * 申請・承認・却下の履歴。編集できる人と承認できる人にだけ返す
 * （誰がいつ判断したかは、業務としてその2者が見られればよい）。
 */
export async function GET(req: Request) {
  const m = await getServerMessages();
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const entityId = url.searchParams.get("entityId")?.trim();
  if ((entity !== "product" && entity !== "substance") || !entityId) {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const editPermission = entity === "product" ? "PRODUCT_EDIT" : "SUBSTANCE_EDIT";
  if (!actor.has(editPermission) && !actor.has("APPROVE")) {
    return jsonError(403, "forbidden", m.errors.forbidden);
  }

  return Response.json({ items: await listApprovalEvents(entity, entityId) });
}
