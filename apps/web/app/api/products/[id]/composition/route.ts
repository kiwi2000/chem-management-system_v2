import { compositionSchema, validateCompositionSum } from "@chem/shared";
import { recordCompositionView } from "@/lib/access-log";
import { recomputeFrom } from "@/lib/expansion-store";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import {
  COMPOSITION_INCLUDE,
  canEditComposition,
  canViewComposition,
  lineWrites,
  toCompositionResponse,
  validateReferences,
  wouldCreateCycle,
} from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { compositionStamp, staleResponse } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { visibilityWhere } from "@/lib/product-service";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ORDER = { displayOrder: "asc" } as const;

/**
 * GET /api/products/[id]/composition
 *
 * 製品が見えない場合は 404（存在ごと隠す）、
 * 製品は見えるが組成が非開示の場合は 403（本体は見えているので存在を隠す意味がない）。
 */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canViewComposition(actor, product)) {
    return jsonError(403, "forbidden", m.composition.withheld);
  }

  const lines = await prisma.compositionLine.findMany({
    where: { parentProductId: id },
    include: COMPOSITION_INCLUDE,
    orderBy: ORDER,
  });

  // 見たことを残す。誰が持ち出したかを後から追えるようにするため
  await recordCompositionView({
    productId: id,
    actorId: actor.user.id,
    lineCount: lines.length,
    expanded: false,
  });

  const settings = await getAppSettings();
  // 画面が持ち帰る印。保存時に添えて送り返してもらう
  const stamp = await compositionStamp(id);
  return Response.json({
    ...toCompositionResponse(lines, settings, m),
    canEdit: canEditComposition(actor, product),
    stamp: stamp.stamp,
  });
}

/**
 * PUT /api/products/[id]/composition — 全置換。
 * 検証は「1件でもエラーがあれば保存しない」。エラーは全件まとめて返す
 * （1つ直すたびに保存し直すのは手間なので）。
 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await prisma.product.findFirst({
    where: { id, deletedAt: null, ...visibilityWhere(actor) },
  });
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canEditComposition(actor, product)) {
    return jsonError(403, "forbidden", m.composition.withheldEdit);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = compositionSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const input = parsed.data;

  /*
    **ほかの人が先に保存していないか。**止めるためではなく、
    見てから決めてもらうため。「このまま保存する」を押されたら通す
  */
  const before = await compositionStamp(id);
  const stale = staleResponse(m, {
    sent: input.stamp,
    now: before.stamp,
    force: input.force === true,
    byName: before.byName,
    at: before.at,
  });
  if (stale) return stale;

  const settings = await getAppSettings();
  const sum = validateCompositionSum(
    input.lines.map((l) => ({ contentPct: l.contentPct ?? null, isBalance: l.isBalance })),
    settings,
    m,
  );
  const errors = [...(await validateReferences(input, actor, m)), ...sum.errors];

  const childIds = input.lines.map((l) => l.childProductId).filter((v) => v != null);
  if (childIds.length > 0 && (await wouldCreateCycle(id, childIds))) {
    errors.push(m.composition.errorCycle);
  }

  if (errors.length > 0) {
    return jsonError(400, "composition_invalid", errors[0] ?? m.errors.validation, { errors });
  }

  await prisma.$transaction([
    prisma.compositionLine.deleteMany({ where: { parentProductId: id } }),
    prisma.compositionLine.createMany({
      data: lineWrites(input).map((l) => ({ ...l, parentProductId: id })),
    }),
    // 組成を変えたら製品の更新者・更新日時も動かす（一覧で更新に気づけるように）
    prisma.product.update({ where: { id }, data: { updatedBy: actor.user.id } }),
  ]);

  /*
    展開結果を作り直す。**この製品だけでは足りない。**
    原材料の中身が変われば、それを使っている製品の中身も変わるので、
    親を何段でもたどって作り直す。取りこぼすと古い結果が静かに残る。

    保存より先に失敗したら困るので、保存が済んだあとに回している。
    ここで失敗しても組成の保存は取り消さない（作り直しは後からやり直せる）。
  */
  const recomputed = await recomputeFrom(id, settings, m).catch((e: unknown) => {
    console.error("展開結果の作り直しに失敗:", id, e);
    return 0;
  });

  await writeAudit({
    entity: "composition_lines",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { lineCount: input.lines.length, totalPct: sum.totalPct, recomputed },
  });

  return Response.json({
    ok: true,
    warnings: sum.warnings,
    totalPct: sum.totalPct,
    balancePct: sum.balancePct,
    // 保存後の印。続けて直せるように返す
    stamp: (await compositionStamp(id)).stamp,
  });
}
