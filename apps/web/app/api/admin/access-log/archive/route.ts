import { requireAdmin } from "@/lib/authz";
import { listArchiveFiles } from "@/lib/access-log-retention";

export const dynamic = "force-dynamic";

/** GET /api/admin/access-log/archive — 保存期間で片づけたときに書き出したファイルの一覧（管理者のみ） */
export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  return Response.json({ items: await listArchiveFiles() });
}
