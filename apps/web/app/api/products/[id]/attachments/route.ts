import { attachmentFieldsSchema, emptyTableState, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission } from "@/lib/authz";
import {
  ATTACHMENT_SELECT,
  canEditAttachments,
  canViewAttachments,
  inspectAttachment,
  toAttachmentDtos,
  visibleProduct,
} from "@/lib/attachment-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { ATTACHMENT_COLUMNS } from "@/lib/list-columns";
import { getAppSettings } from "@/lib/settings";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 既定は並べ替えなし（サーバーが新しいものを上にする） */
const DEFAULT_STATE = emptyTableState([]);

/**
 * GET /api/products/[id]/attachments — 添付ファイルの一覧（中身は載せない）。共通の表の並べ替え・絞り込み・ページ送り。
 * **見られるのは製品が見えて、組成を見られる人だけ**（主な添付は組成が書かれた SDS のため）
 */
export async function GET(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_VIEW");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await visibleProduct(actor, id);
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canViewAttachments(actor, product)) return jsonError(403, "forbidden", m.errors.forbidden);

  const state = parseTableState(
    new URL(req.url).searchParams,
    ATTACHMENT_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { productId: id, ...buildWhere(ATTACHMENT_COLUMNS, state.filters) };
  const [rows, total] = await Promise.all([
    prisma.productAttachment.findMany({
      where,
      orderBy: buildOrderBy(ATTACHMENT_COLUMNS, state.sort, { createdAt: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      select: ATTACHMENT_SELECT,
    }),
    prisma.productAttachment.count({ where }),
  ]);
  return Response.json({
    items: await toAttachmentDtos(rows),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/products/[id]/attachments — 1 件追加（multipart: `file`・`title`・`kind`・`description`）。
 * 製品を編集でき、組成を見られる人だけ。形式・上限・マクロ・種類の選択肢はシステム設定に従う
 */
export async function POST(req: Request, { params }: Ctx) {
  const actor = await requirePermission("PRODUCT_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const product = await visibleProduct(actor, id);
  if (!product) return jsonError(404, "not_found", m.errors.notFound);
  if (!canEditAttachments(actor, product)) return jsonError(403, "forbidden", m.errors.forbidden);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form", m.errors.validation);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "no_file", m.attachments.fileRequired);
  const parsed = attachmentFieldsSchema.safeParse({
    title: form.get("title") ?? "",
    kind: (form.get("kind") as string | null) || null,
    description: (form.get("description") as string | null) || null,
  });
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const settings = await getAppSettings();
  if (parsed.data.kind && !settings.attachmentKinds.includes(parsed.data.kind)) {
    return jsonError(400, "validation_error", m.attachments.kindInvalid);
  }

  const name = file.name.slice(0, 255);
  const buf = Buffer.from(await file.arrayBuffer());
  const checked = await inspectAttachment(name, buf, settings);
  if (!checked.ok) {
    const r = m.attachments.rejects;
    const reason =
      checked.reason === "tooLarge"
        ? r.tooLarge(settings.attachmentMaxMb)
        : checked.reason === "badType"
          ? r.badType(settings.attachmentExtensions)
          : r[checked.reason];
    return jsonError(400, `rejected_${checked.reason}`, `${name}: ${reason}`);
  }

  const row = await prisma.productAttachment.create({
    data: {
      productId: id,
      title: parsed.data.title,
      kind: parsed.data.kind ?? null,
      description: parsed.data.description ?? null,
      fileName: name,
      mime: checked.mime,
      size: buf.length,
      data: new Uint8Array(buf),
      createdBy: actor.user.id,
      updatedBy: actor.user.id,
    },
    select: ATTACHMENT_SELECT,
  });
  await writeAudit({
    entity: "product_attachment",
    entityId: row.id,
    action: "create",
    actorId: actor.user.id,
    diff: {
      productId: id,
      productCode: product.code,
      title: row.title,
      fileName: name,
      size: buf.length,
    },
  });
  const [dto] = await toAttachmentDtos([row]);
  return Response.json(dto, { status: 201 });
}
