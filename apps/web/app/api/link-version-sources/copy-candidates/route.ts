import { jsonError, requirePermission } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";
import { copyCandidates } from "@/lib/link-copy";

export const dynamic = "force-dynamic";

/**
 * GET /api/link-version-sources/copy-candidates?versionId=&sourceId= — 写し元にできる版（2026-10-04）。
 * 同じデータソースを持ち、中身（リンクかインベントリの行）がある、ほかの版。基準日の新しい順
 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const params = new URL(req.url).searchParams;
  const versionId = params.get("versionId");
  const sourceId = params.get("sourceId");
  if (!versionId || !sourceId) return jsonError(400, "validation_error", m.errors.validation);
  return Response.json({ items: await copyCandidates(versionId, sourceId) });
}
