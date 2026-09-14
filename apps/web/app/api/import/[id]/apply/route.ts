import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { startApply } from "@/lib/import/apply";
import { anyRunning } from "@/lib/import/jobs";

/**
 * POST /api/import/[id]/apply — 「反映」。一時領域の行（apply = true）を本体に書く（裏で）。
 * 確認済み（STAGED）のものだけ。反映後は「要再計算」が出るので、判定し直しは管理者が押す
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("DATA_IMPORT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id } = await ctx.params;
  const job = await prisma.importJob.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!job) return jsonError(404, "not_found", m.errors.notFound);
  if (job.status !== "STAGED") return jsonError(409, "bad_status", m.importExport.errors.badStatus);
  const toApply = await prisma.importRow.count({
    where: { jobId: id, apply: true, action: { in: ["ADD", "UPDATE", "CONFLICT"] } },
  });
  if (toApply === 0) return jsonError(409, "nothing", m.importExport.errors.nothingToApply);
  if (anyRunning()) return jsonError(409, "running", m.importExport.errors.otherRunning);
  if (!startApply(id, actor.user.id))
    return jsonError(409, "running", m.importExport.errors.running);
  return Response.json({ ok: true, rows: toApply });
}
