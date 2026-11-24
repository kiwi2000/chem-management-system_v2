import { emptyTableState, metalFactorSchema, normalizeCas, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { METAL_FACTOR_COLUMNS } from "@/lib/list-columns";
import { findSubstancesByCas, toMetalFactorDto } from "@/lib/metal-factor-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import { metalFactorDelete } from "@/lib/metal-factor-delete";
import { runStampedDelete } from "@/lib/stamped-delete";
import { guardUnique } from "@/lib/unique-violation";

export const dynamic = "force-dynamic";

/** 既定の並びは CAS 順、同じ CAS なら元素順 */
const DEFAULT_STATE = emptyTableState([
  { column: "casNumber", direction: "asc" },
  { column: "metalElement", direction: "asc" },
]);

/** GET /api/metal-factors — 一覧 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    METAL_FACTOR_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  const where = {
    deletedAt: null,
    ...buildWhere(METAL_FACTOR_COLUMNS, state.filters),
  };

  const [items, total] = await Promise.all([
    prisma.metalConversionFactor.findMany({
      where,
      orderBy: buildOrderBy(METAL_FACTOR_COLUMNS, state.sort, { casNormalized: "asc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.metalConversionFactor.count({ where }),
  ]);

  // 一覧に出ている分だけ物質を引く（全件を持ってこない）
  const byCas = await findSubstancesByCas([...new Set(items.map((f) => f.casNormalized))]);

  return Response.json({
    items: items.map((f) => toMetalFactorDto(f, byCas.get(f.casNormalized) ?? [])),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/metal-factors — 追加。
 * 同じ CAS × 金属元素を論理削除していた場合は、その行を復活させて内容を更新する
 * （一意制約が残るため。物質マスタのようにキーを退避させるとキーの意味が壊れる）。
 */
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
  const parsed = metalFactorSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const casNormalized = normalizeCas(v.casNumber);

  const existing = await prisma.metalConversionFactor.findUnique({
    where: {
      casNormalized_metalElement: { casNormalized, metalElement: v.metalElement },
    },
  });

  const warnings: string[] = [];
  const clash = async () => {
    const live = await prisma.metalConversionFactor.findFirst({
      where: { casNormalized, metalElement: v.metalElement, deletedAt: null },
    });
    return live
      ? jsonError(
          409,
          "duplicate_metal_factor",
          m.errors.duplicateMetalFactor(casNormalized, v.metalElement),
        )
      : null;
  };
  if (existing && existing.deletedAt === null) {
    return jsonError(
      409,
      "duplicate_metal_factor",
      m.errors.duplicateMetalFactor(casNormalized, v.metalElement),
    );
  }

  const data = {
    casNumber: casNormalized,
    casNormalized,
    metalElement: v.metalElement,
    ratioPct: v.ratioPct,
    updatedBy: actor.user.id,
  };

  // 同じ組をほぼ同時に作られたら、一意の決まりで止まる。そのときもいつもの文で返す
  const written = await guardUnique(m, clash, async () => {
    if (existing) {
      await prisma.metalConversionFactor.update({
        where: { id: existing.id },
        data: { ...data, deletedAt: null },
      });
      return existing.id;
    }
    const created = await prisma.metalConversionFactor.create({
      data: { ...data, createdBy: actor.user.id },
    });
    return created.id;
  });
  if (written instanceof Response) return written;
  const id = written;
  if (existing) warnings.push(m.metalFactors.revived);

  // 物質として未登録の CAS でも登録できるが、打ち間違いに気づけるよう知らせる
  const matched = await findSubstancesByCas([casNormalized]);
  if ((matched.get(casNormalized) ?? []).length === 0) {
    warnings.push(m.metalFactors.warnUnknownCas);
  }

  await writeAudit({
    entity: "metal_conversion_factors",
    entityId: id,
    action: "create",
    actorId: actor.user.id,
    diff: { casNumber: casNormalized, metalElement: v.metalElement, ratioPct: v.ratioPct },
  });
  return Response.json({ id, warnings }, { status: 201 });
}

/**
 * DELETE /api/metal-factors — まとめて削除（本文 `{ items: [{ id, stamp }], force? }`。lib/stamped-delete.ts）。
 * 金属換算係数。一覧を開いたあとでほかの人が変更していれば、何も消さずに知らせる
 */
export async function DELETE(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  return runStampedDelete(req, m, metalFactorDelete(actor));
}
