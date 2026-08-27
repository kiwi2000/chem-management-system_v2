import {
  documentTemplateSchema,
  emptyTableState,
  normalizeCode,
  parseTableState,
} from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { DOC_TEMPLATE_SELECT, emptyContent, toDocTemplateDto } from "@/lib/doc-template-service";
import { getServerMessages } from "@/lib/i18n";
import { DOC_TEMPLATE_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

// 既定は通番の順。作った順に並ぶ
const DEFAULT_STATE = emptyTableState([{ column: "seq", direction: "asc" }]);

/**
 * GET /api/doc-templates — テンプレートの一覧。
 *
 * **見るのは誰でもよい。**帳票を作るのは全員ができることなので、
 * どんなテンプレートがあるかは選ぶために要る。
 * 作り替えられるかどうかは別（POST 以降で見る）。
 */
export async function GET(req: Request) {
  // 様式を見るのは、作る人の入口。編集は別（DOC_TEMPLATE_EDIT）
  const actor = await requirePermission("DOCUMENT_CREATE");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    DOC_TEMPLATE_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { deletedAt: null, ...buildWhere(DOC_TEMPLATE_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.documentTemplate.findMany({
      where,
      orderBy: buildOrderBy(DOC_TEMPLATE_COLUMNS, state.sort, { seq: "asc" }),
      select: DOC_TEMPLATE_SELECT,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.documentTemplate.count({ where }),
  ]);

  return Response.json({
    items: items.map(toDocTemplateDto),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/doc-templates — テンプレートを1件作る。
 *
 * **中身は空で作る。**ブロックを並べるのは編集画面の仕事なので、
 * ここでは入れものだけを用意して、すぐ編集へ移れるようにする。
 */
export async function POST(req: Request) {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = documentTemplateSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error);
  }
  const input = parsed.data;
  const codeNormalized = normalizeCode(input.code);

  const dup = await prisma.documentTemplate.findUnique({ where: { codeNormalized } });
  if (dup) return jsonError(409, "duplicate_code", m.docTemplates.duplicateCode(input.code));

  const row = await prisma.documentTemplate.create({
    data: {
      code: input.code,
      codeNormalized,
      nameJa: input.nameJa,
      nameEn: input.nameEn ?? null,
      target: input.target,
      locale: input.locale,
      active: input.active,
      note: input.note ?? null,
      // Json の列なので、こちらの型のまま渡せない
      content: emptyContent() as unknown as object,
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
    select: DOC_TEMPLATE_SELECT,
  });
  await writeAudit({
    entity: "document_templates",
    entityId: row.id,
    action: "create",
    actorId: actor.user.id,
    diff: { code: row.code, target: row.target },
  });

  return Response.json(toDocTemplateDto(row), { status: 201 });
}
