import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { saveSummary, setConfirmed, summarizeEntry } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; action: string }> };

/**
 * POST /api/prtr/entries/[id]/summary/save|confirm|unconfirm — 集計の保存と確定（S22。2026-10-02 設計）。
 * - save: いまの集計を作り直してから写し取り「保存した集計」にする（未確定になる）
 * - confirm: 保存した集計を確定にする（入力は読み取り専用になる）。保存していなければ断る
 * - unconfirm: 確定を外す。入力できる人なら誰でも（記録は残す）
 */
export async function POST(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id, action } = await params;
  const m = await getServerMessages();
  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;

  if (action === "save") {
    // 保存するのは最新の入力から出した集計。古い行を写さないよう、先に作り直す
    await summarizeEntry(entry, actor.user.id);
    await saveSummary(id, actor.user.id);
  } else if (action === "confirm") {
    const summary = await prisma.prtrSummary.findUnique({ where: { entryId: id } });
    if (!summary || summary.savedAt === null) {
      return jsonError(409, "not_saved", m.prtr.summary.notSaved);
    }
    await setConfirmed(id, actor.user.id, true);
  } else if (action === "unconfirm") {
    await setConfirmed(id, actor.user.id, false);
  } else {
    return jsonError(404, "not_found", m.errors.notFound);
  }
  await writeAudit({
    entity: "prtr_summaries",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { fiscalYear: entry.fiscalYear, summaryAction: action },
  });
  return Response.json({ ok: true });
}
