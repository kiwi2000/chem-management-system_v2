import { impurityPatternSchema, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAnyPermission, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { countSubstancesByPattern, toImpurityPatternDto } from "@/lib/impurity-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/impurity-patterns — 一覧（S21）。
 *
 * 件数が知れているので絞り込み・ページ送りは持たない。並びは表示順のみ。
 * 物質の一覧・組成の候補でも選択肢として引くので、**見るのは REGULATION_VIEW ではなく
 * 物質を見られる人にも許す**（どちらかを持っていればよい）
 */
export async function GET() {
  const actor = await requireAnyPermission("REGULATION_VIEW", "SUBSTANCE_VIEW");
  if (actor instanceof Response) return actor;

  const items = await prisma.impurityPattern.findMany({
    where: { deletedAt: null },
    orderBy: [{ displayOrder: "asc" }, { codeNormalized: "asc" }],
  });
  const counts = await countSubstancesByPattern(items.map((p) => p.id));

  return Response.json({
    items: items.map((p) => toImpurityPatternDto(p, counts.get(p.id) ?? 0)),
    total: items.length,
    page: 1,
    pageSize: items.length,
  });
}

/** POST /api/impurity-patterns — 追加 */
export async function POST(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = impurityPatternSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const dup = await prisma.impurityPattern.findFirst({ where: { codeNormalized } });
  if (dup) return jsonError(409, "duplicate", m.impurityPatterns.duplicateCode(v.code));

  const last = await prisma.impurityPattern.findFirst({
    where: { deletedAt: null },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });

  const created = await prisma.impurityPattern.create({
    data: {
      code: v.code,
      codeNormalized,
      nameJa: v.nameJa,
      nameEn: v.nameEn ?? null,
      note: v.note ?? null,
      displayOrder: (last?.displayOrder ?? 0) + 1,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
  });

  await writeAudit({
    entity: "impurity_patterns",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameJa: v.nameJa },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
