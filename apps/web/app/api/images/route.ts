import { emptyTableState, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAnyPermission, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { IMAGE_INPUT_MIMES, IMAGE_UPLOAD_MAX, processImage } from "@/lib/image-process";
import { IMAGE_SELECT, toImageDto, usageCounts } from "@/lib/image-service";
import { IMAGE_COLUMNS } from "@/lib/list-columns";
import { getAppSettings } from "@/lib/settings";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** 新しいものが上。入れたばかりの画像をすぐ選べるように */
const DEFAULT_STATE = emptyTableState([{ column: "createdAt", direction: "desc" }]);

/**
 * GET /api/images — 画像ライブラリの一覧（中身は載せない）。
 * 見るのは帳票を作れる人かテンプレートを直せる人（画像ブロックで選ぶため）
 */
export async function GET(req: Request) {
  const actor = await requireAnyPermission("DOCUMENT_CREATE", "DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    IMAGE_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = buildWhere(IMAGE_COLUMNS, state.filters);
  const [items, total] = await Promise.all([
    prisma.imageAsset.findMany({
      where,
      orderBy: buildOrderBy(IMAGE_COLUMNS, state.sort, { createdAt: "desc" }),
      select: IMAGE_SELECT,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.imageAsset.count({ where }),
  ]);
  const used = await usageCounts(items.map((i) => i.id));
  return Response.json({
    items: items.map((i) => toImageDto(i, used.get(i.id) ?? 0)),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
}

/**
 * POST /api/images — アップロード（複数可。multipart の `files`）。
 * 1 枚ずつシステム設定の決まりで整えて入れる。読めないものは飛ばして理由を返す
 */
export async function POST(req: Request) {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form", m.errors.validation);
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return jsonError(400, "no_files", m.errors.validation);

  const settings = await getAppSettings();
  const added: { id: string; name: string }[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const f of files) {
    if (f.size > IMAGE_UPLOAD_MAX) {
      rejected.push({ name: f.name, reason: m.images.rejectTooLarge });
      continue;
    }
    // 拡張子や申告の型は当てにならないので、実際に読めるかで決める
    if (f.type && !IMAGE_INPUT_MIMES.has(f.type)) {
      rejected.push({ name: f.name, reason: m.images.rejectNotImage });
      continue;
    }
    try {
      const out = await processImage(Buffer.from(await f.arrayBuffer()), settings);
      const row = await prisma.imageAsset.create({
        data: {
          name: f.name.replace(/\.[^.]+$/, "").slice(0, 255) || f.name.slice(0, 255),
          mime: out.mime,
          width: out.width,
          height: out.height,
          size: out.data.byteLength,
          data: new Uint8Array(out.data),
          thumb: new Uint8Array(out.thumb),
          createdBy: actor.user.id,
        },
        select: { id: true, name: true },
      });
      added.push(row);
    } catch {
      rejected.push({ name: f.name, reason: m.images.rejectNotImage });
    }
  }
  if (added.length > 0) {
    await writeAudit({
      entity: "image_assets",
      action: "create",
      actorId: actor.user.id,
      diff: { count: added.length, names: added.map((a) => a.name).slice(0, 50) },
    });
  }
  return Response.json({ added, rejected }, { status: added.length > 0 ? 201 : 400 });
}
