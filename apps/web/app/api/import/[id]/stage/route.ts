import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { anyRunning } from "@/lib/import/jobs";
import { startStage } from "@/lib/import/stage";

/**
 * POST /api/import/[id]/stage — 「インポート」。ファイルを読み、本体と突き合わせて一時領域に入れる（裏で）。
 * 本体には書かない。終わると status が STAGED になり、画面で確認してから「反映」する
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission("DATA_IMPORT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  const { id } = await ctx.params;
  const job = await prisma.importJob.findUnique({
    where: { id },
    select: { id: true, status: true, fileData: true },
  });
  if (!job) return jsonError(404, "not_found", m.errors.notFound);
  if (!["UPLOADED", "STAGED", "FAILED"].includes(job.status))
    return jsonError(409, "bad_status", m.importExport.errors.badStatus);
  if (!job.fileData) return jsonError(409, "no_file", m.importExport.errors.fileGone);
  // 取り込みは同時に 1 つだけ（本体を読み書きする順番が崩れないように）
  const other = anyRunning();
  if (other) return jsonError(409, "running", m.importExport.errors.otherRunning);
  if (!startStage(id)) return jsonError(409, "running", m.importExport.errors.running);
  return Response.json({ ok: true });
}
