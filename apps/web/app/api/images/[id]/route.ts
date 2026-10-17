import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireAnyPermission, requirePermission } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { IMAGE_SELECT, toImageDto, usageOf } from "@/lib/image-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/images/[id] — 画像そのもの（`?thumb=1` なら一覧用の小さな絵）。
 * ブラウザに覚えさせてよい（中身は変わらない。差し替えは別の id になる）
 */
export async function GET(req: Request, { params }: Ctx) {
  const actor = await requireAnyPermission("DOCUMENT_CREATE", "DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const thumb = q.get("thumb") === "1";

  // `?meta=1` は中身ではなく名前・大きさ（画像ブロックが「いま選んでいる 1 枚」を出すため）
  if (q.get("meta") === "1") {
    const meta = await prisma.imageAsset.findUnique({ where: { id }, select: IMAGE_SELECT });
    if (!meta) return new Response(null, { status: 404 });
    const used = await usageOf([id]);
    return Response.json(toImageDto(meta, used.get(id) ?? []));
  }

  const row = thumb
    ? await prisma.imageAsset
        .findUnique({ where: { id }, select: { thumb: true, mime: true } })
        .then((r) => (r ? { bytes: r.thumb, mime: r.mime } : null))
    : await prisma.imageAsset
        .findUnique({ where: { id }, select: { data: true, mime: true } })
        .then((r) => (r ? { bytes: r.data, mime: r.mime } : null));
  if (!row) return new Response(null, { status: 404 });
  const bytes = row.bytes;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": thumb ? "image/png" : row.mime,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=86400",
    },
  });
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  note: z.string().trim().max(2000).nullable().optional(),
});

/** PUT /api/images/[id] — 名前と備考を直す */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  // 楽観的ロックの印。無ければ 400
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;
  const exists = await prisma.imageAsset.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError(404, "not_found", m.errors.notFound);

  // 印が合う行だけを更新する。当たらなければ、ほかの人が先に保存している
  const hit = await prisma.imageAsset.updateMany({
    where: { id, ...stampWhere(lock) },
    data: { name: parsed.data.name, note: parsed.data.note ?? null },
  });
  if (hit.count === 0) {
    // 画像は更新者を持たないので、時刻だけ添える
    return staleFromRow(
      m,
      await prisma.imageAsset.findUnique({ where: { id }, select: { updatedAt: true } }),
    );
  }
  // 更新後の行を返す（DTO の stamp が新しい印）
  const row = await prisma.imageAsset.findUniqueOrThrow({ where: { id }, select: IMAGE_SELECT });
  const used = await usageOf([id]);
  return Response.json(toImageDto(row, used.get(id) ?? []));
}

/**
 * DELETE /api/images/[id] — 消す。
 * **テンプレートで使っている画像は消せない**（紙面に穴が空く）。先にテンプレートから外してもらう
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requirePermission("DOC_TEMPLATE_EDIT");
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const row = await prisma.imageAsset.findUnique({ where: { id }, select: { name: true } });
  if (!row) return jsonError(404, "not_found", m.errors.notFound);
  const used = ((await usageOf([id])).get(id) ?? []).length;
  if (used > 0) return jsonError(409, "in_use", m.images.inUse(used));

  await prisma.imageAsset.delete({ where: { id } });
  await writeAudit({
    entity: "image_assets",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { name: row.name },
  });
  return Response.json({ ok: true });
}
