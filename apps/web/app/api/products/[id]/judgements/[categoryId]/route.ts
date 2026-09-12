import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { canEditComposition } from "@/lib/composition-service";
import { getCurrentVersion } from "@/lib/current-version";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { visibilityWhere } from "@/lib/product-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; categoryId: string }> };

/**
 * PUT /api/products/[id]/judgements/[categoryId] — 確認する／判定を上書きする。
 *
 * 操作は2つあるが、どちらも**要確認を OFF にする**。
 *
 *   確認する           … 判定はそのまま。「見た」ことだけを残す
 *   判定を変えて確認する … 判定を人の値に変え、出どころを「人」にする
 *
 * どちらも**誰が・いつ・何を根拠に**を残す。
 * 監査で「なぜ非該当にしたのか」と問われたときに答えられることが、
 * この機能のいちばんの値打ちなので。
 *
 * **記録は判定の行ではなく、製品 × 規制区分の「人の判断」（ProductDecision）に残す**
 * （2026-09-12 決定）。判定し直したとき、前提（システムの判定と、どの法文物質名に
 * どのCASで当たったか）が同じなら当てはめ直し、違えば当てはめずに要確認にする。
 * 法規制バージョンが変わっただけでは消えず、組成や法律が変われば効かなくなる。
 * 現在のバージョンの判定の行にも同じ内容を書いて、画面にすぐ反映する。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id, categoryId } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  // 判定を動かすのは、組成を触れる人と同じ範囲に揃える
  if (!canEditComposition(actor, product)) {
    return jsonError(403, "forbidden", m.composition.withheldEdit);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const { verdict, note } = (body ?? {}) as { verdict?: unknown; note?: unknown };
  if (verdict !== undefined && verdict !== "APPLICABLE" && verdict !== "NOT_APPLICABLE") {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  if (note !== undefined && note !== null && typeof note !== "string") {
    return jsonError(400, "validation_error", m.errors.validation);
  }

  // 判断できるのは、現在のバージョンで保存してある判定だけ
  const version = await getCurrentVersion();
  if (!version) return jsonError(404, "not_found", m.errors.notFound);
  const current = await prisma.productJudgement.findUnique({
    where: {
      productId_categoryId_versionId: { productId: id, categoryId, versionId: version.id },
    },
    select: {
      id: true,
      verdict: true,
      systemVerdict: true,
      premise: true,
      needsReview: true,
      reviewReasons: true,
    },
  });
  if (!current) return jsonError(404, "not_found", m.errors.notFound);

  // 判定を指定しなければ、いまの判定のまま「見た」ことだけを残す
  const next = (verdict as "APPLICABLE" | "NOT_APPLICABLE" | undefined) ?? current.verdict;
  const changed = next !== current.verdict;
  // システムの判定と同じ値に戻したなら、それは「人の値」ではない
  const overridden = next !== current.systemVerdict;
  const decidedAt = new Date();
  const decidedNote = typeof note === "string" && note.trim() !== "" ? note.trim() : null;

  await prisma.$transaction([
    // 人の判断。判定し直しても、前提が同じあいだは引き継がれる
    prisma.productDecision.upsert({
      where: { productId_categoryId: { productId: id, categoryId } },
      create: {
        productId: id,
        categoryId,
        verdict: overridden ? next : null,
        systemVerdict: current.systemVerdict,
        premise: current.premise,
        decidedBy: actor.user.id,
        decidedAt,
        decidedNote,
      },
      update: {
        verdict: overridden ? next : null,
        systemVerdict: current.systemVerdict,
        premise: current.premise,
        decidedBy: actor.user.id,
        decidedAt,
        decidedNote,
      },
    }),
    // 現在のバージョンの判定の行にも写して、画面にすぐ出す
    prisma.productJudgement.update({
      where: { id: current.id },
      data: {
        verdict: next,
        // 人が触ったものは、システムが出したものと見分けが付くようにする
        source: overridden ? "USER" : "SYSTEM",
        needsReview: false,
        // 「以前の判断を外した」は、判断し直したので消える。ほかの警告は残す
        reviewReasons: current.reviewReasons.filter((r) => r !== "decisionDropped"),
        decidedBy: actor.user.id,
        decidedAt,
        decidedNote,
      },
    }),
  ]);

  await writeAudit({
    entity: "product_judgements",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: {
      categoryId,
      from: current.verdict,
      to: next,
      changed,
      hadReview: current.needsReview,
      note: typeof note === "string" ? note.slice(0, 500) : null,
    },
  });

  return Response.json({ ok: true, verdict: next, changed });
}
