import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { canEditComposition } from "@/lib/composition-service";
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
 * **この記録は、組成や法律が変われば判定ごと消える。**
 * 変わった事実の上に古い判断が乗ったままになるほうが危ないため
 * （何をしたかはアクセス記録の側に残るので、追うことはできる）。
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

  const current = await prisma.productJudgement.findUnique({
    where: { productId_categoryId: { productId: id, categoryId } },
    select: { id: true, verdict: true, needsReview: true },
  });
  if (!current) return jsonError(404, "not_found", m.errors.notFound);

  // 判定を指定しなければ、いまの判定のまま「見た」ことだけを残す
  const next = (verdict as "APPLICABLE" | "NOT_APPLICABLE" | undefined) ?? current.verdict;
  const changed = next !== current.verdict;

  await prisma.productJudgement.update({
    where: { id: current.id },
    data: {
      verdict: next,
      // 人が触ったものは、システムが出したものと見分けが付くようにする
      source: changed ? "USER" : undefined,
      needsReview: false,
      decidedBy: actor.user.id,
      decidedAt: new Date(),
      decidedNote: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    },
  });

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
