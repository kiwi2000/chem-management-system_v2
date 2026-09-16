import { documentTemplateCopySchema, normalizeCode } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { DOC_TEMPLATE_SELECT, toDocTemplateDto } from "@/lib/doc-template-service";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/doc-templates/[id]/copy — テンプレートを複製する。
 *
 * **保存されているものを写す。**編集画面で書きかけの変えぶんは写さない
 * （画面の側で、保存してから複製するように促す）。
 * 中身・対象・作りかた・言語・預けたファイルまで全部写し、名前だけ聞く。
 * コードは空なら「元のコード-2」「-3」… の空いている番号で付ける
 * （コードは一意でないといけないが、写すたびに考えさせるほどのものではない）。
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const src = await prisma.documentTemplate.findFirst({
    where: { id, deletedAt: null },
    select: {
      code: true,
      nameEn: true,
      target: true,
      kind: true,
      content: true,
      fileData: true,
      fileName: true,
      fileUpdatedAt: true,
      locale: true,
      active: true,
      usesRecipient: true,
      note: true,
    },
  });
  if (!src) return jsonError(404, "not_found", m.errors.notFound);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = documentTemplateCopySchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error);
  }
  const input = parsed.data;

  let code = input.code?.trim() ?? "";
  if (code) {
    const dup = await prisma.documentTemplate.findUnique({
      where: { codeNormalized: normalizeCode(code) },
    });
    if (dup) return jsonError(409, "duplicate_code", m.docTemplates.duplicateCode(code));
  } else {
    code = await freeCopyCode(src.code);
  }

  const row = await prisma.documentTemplate.create({
    data: {
      code,
      codeNormalized: normalizeCode(code),
      nameJa: input.nameJa,
      // 英語名は聞かない。あれば「(copy)」を添えて、元と見分けがつくようにする
      nameEn: src.nameEn ? `${src.nameEn} (copy)` : null,
      target: src.target,
      kind: src.kind,
      content: src.content as object,
      fileData: src.fileData,
      fileName: src.fileName,
      fileUpdatedAt: src.fileUpdatedAt,
      locale: src.locale,
      active: src.active,
      usesRecipient: src.usesRecipient,
      note: src.note,
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
    diff: { code: row.code, target: row.target, copiedFrom: src.code },
  });

  return Response.json(toDocTemplateDto(row), { status: 201 });
}

/**
 * 「元のコード-2」から順に、まだ使われていないコードを探す。
 * 消したもの（deletedAt 付き）も一意の制約に引っかかるので、消したぶんも避ける
 */
async function freeCopyCode(base: string): Promise<string> {
  const stem = base.slice(0, 50 - "-999".length);
  for (let n = 2; n < 1000; n++) {
    const code = `${stem}-${n}`;
    const hit = await prisma.documentTemplate.findUnique({
      where: { codeNormalized: normalizeCode(code) },
      select: { id: true },
    });
    if (!hit) return code;
  }
  throw new Error("copy code exhausted");
}
