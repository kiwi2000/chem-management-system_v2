import { readFile } from "node:fs/promises";
import { requireAdmin } from "@/lib/authz";
import { archiveFilePath } from "@/lib/access-log-retention";
import { writeAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/**
 * GET /api/admin/access-log/archive/<名前> — 書き出したファイルを落とす（管理者のみ）。
 * 名前は決まった形のものだけ受け、書き出し先の外には出ない。記録を外へ出すので、落としたことは残す
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const { name } = await params;
  const path = await archiveFilePath(name);
  if (!path) return new Response(null, { status: 404 });
  const body = await readFile(path);
  await writeAudit({
    entity: "audit_logs",
    action: "export",
    actorId: actor.user.id,
    diff: { file: name, size: body.byteLength },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/tab-separated-values; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
    },
  });
}
