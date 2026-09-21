import { prtrQuantitySchema } from "@chem/shared";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requirePrtrOrg } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { findProductByCode, QUANTITY_INCLUDE, toQuantityDto } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/prtr/entries/[id]/quantities — 製品ごとの数量を 1 件足す（S22）。
 * 同じ製品が既にあれば上書きする（画面の 1 件登録は「同じ製品なら直す」の意味で使う）
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const entry = await prisma.prtrEntry.findUnique({ where: { id } });
  if (!entry) return jsonError(404, "not_found", m.errors.notFound);
  const denied = await requirePrtrOrg(actor, entry.organisationId);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = prtrQuantitySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const product = await findProductByCode(v.productCode);
  if (!product) {
    return jsonError(400, "validation_error", m.prtr.quantities.productNotFound(v.productCode), {
      fieldErrors: { productCode: [m.prtr.quantities.productNotFound(v.productCode)] },
    });
  }
  if (entry.method !== "MEASURED" && v.shippedKg == null) {
    return jsonError(400, "validation_error", m.prtr.quantities.shippedRequired, {
      fieldErrors: { shippedKg: [m.prtr.quantities.shippedRequired] },
    });
  }

  const data = {
    purchasedKg: new Prisma.Decimal(v.purchasedKg),
    shippedKg: v.shippedKg == null ? null : new Prisma.Decimal(v.shippedKg),
    source: "MANUAL" as const,
    updatedBy: actor.user.id,
  };
  const row = await prisma.prtrQuantity.upsert({
    where: { entryId_productId: { entryId: id, productId: product.id } },
    create: { entryId: id, productId: product.id, ...data },
    update: data,
    include: QUANTITY_INCLUDE,
  });
  await writeAudit({
    entity: "prtr_quantities",
    entityId: row.id,
    action: "update",
    actorId: actor.user.id,
    diff: { product: product.code, purchasedKg: v.purchasedKg, shippedKg: v.shippedKg ?? null },
  });
  return Response.json({ item: toQuantityDto(row) }, { status: 201 });
}
