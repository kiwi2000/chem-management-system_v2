import {
  emptyTableState,
  normalizeCode,
  parseTableState,
  regulationClassSchema,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, scopeIds } from "@/lib/authz";
import { getCurrentVersion } from "@/lib/current-version";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { guardUnique } from "@/lib/unique-violation";
import { CLASS_INCLUDE, toClassDto } from "@/lib/law-service";
import { regulationClassColumns } from "@/lib/list-columns";
import { buildWhere } from "@/lib/table-query";
import { regulationClassDelete } from "@/lib/law-delete";
import { runStampedDelete } from "@/lib/stamped-delete";

export const dynamic = "force-dynamic";

/**
 * GET /api/regulation-classes?categoryId=... — その区分の分類を並び順で返す。
 * 数は多くても数個なので改ページは持たない。
 *
 * **結び付いた CAS・物質名で絞れる**（`f.casNumber` / `f.substanceName`。2026-09-20 指示）。
 * 法律の表で「トルエン」と絞ったとき、区分の下に当たった分類だけを並べるため。
 * 条件は区分の一覧と同じ引きかた（いま判定に使っている版・無効にしていないデータソース）
 */
export async function GET(req: Request) {
  const actor = await requirePermission("REGULATION_VIEW");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  const url = new URL(req.url);
  const categoryId = url.searchParams.get("categoryId");
  if (!categoryId) return jsonError(400, "validation_error", m.errors.validation);

  const version = await getCurrentVersion();
  const columns = regulationClassColumns(version?.id ?? null, {
    seeAll: actor.has("APPROVE"),
    userId: actor.user.id,
    ownerIds: scopeIds(actor, "substanceView"),
  });
  const state = parseTableState(
    url.searchParams,
    columns.map((c) => ({ key: c.key, kind: c.kind })),
    emptyTableState(),
  );

  const items = await prisma.regulationClass.findMany({
    where: { categoryId, deletedAt: null, ...buildWhere(columns, state.filters) },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    include: CLASS_INCLUDE,
  });
  return Response.json({ items: items.map(toClassDto) });
}

/** POST /api/regulation-classes — 分類を1件足す */
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
  const parsed = regulationClassSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  const codeNormalized = normalizeCode(v.code);

  const category = await prisma.regulationCategory.findFirst({
    where: { id: v.categoryId, deletedAt: null },
  });
  if (!category) return jsonError(404, "not_found", m.errors.notFound);

  const clash = async () => {
    const live = await prisma.regulationClass.findFirst({
      where: { categoryId: v.categoryId, codeNormalized, deletedAt: null },
    });
    return live
      ? jsonError(409, "duplicate_class_code", m.regulationClasses.duplicateCode(v.code))
      : null;
  };
  const clashed = await clash();
  if (clashed) return clashed;

  // 同じコードをほぼ同時に作られたら、一意の決まりで止まる。そのときもいつもの文で返す
  const created = await guardUnique(m, clash, () =>
    prisma.regulationClass.create({
      data: {
        code: v.code,
        codeNormalized,
        categoryId: v.categoryId,
        nameOriginal: v.nameOriginal ?? null,
        nameLang: v.nameLang ?? null,
        nameJa: v.nameJa ?? null,
        nameEn: v.nameEn ?? null,
        displayOrder: v.displayOrder,
        interactionGroup: v.interactionGroup ?? null,
        rank: v.rank ?? null,
        note: v.note ?? null,
        createdBy: actor.user.id,
        updatedBy: actor.user.id,
      },
    }),
  );
  if (created instanceof Response) return created;

  await writeAudit({
    entity: "regulation_classes",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: v.code, nameOriginal: v.nameOriginal ?? null, categoryId: v.categoryId },
  });
  return Response.json({ id: created.id }, { status: 201 });
}

/**
 * DELETE /api/regulation-classes — まとめて論理削除（lib/stamped-delete.ts）。
 * 配下の法文物質も一緒に消す。区分の分類が無くなったら既定の分類を作り直す
 */
export async function DELETE(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  return runStampedDelete(req, m, regulationClassDelete(actor));
}
