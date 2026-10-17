import { newsSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseEditStamp, rowStamp, staleFromRow, stampWhere } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { canEditNews, NEWS_INCLUDE, parseDateOnly, toNewsDto } from "@/lib/news-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/news/[id] — 下書きは編集できる人だけが読める */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const item = await prisma.news.findUnique({ where: { id }, include: NEWS_INCLUDE });
  if (!item) return jsonError(404, "not_found", m.errors.notFound);
  if (item.status === "DRAFT" && !canEditNews(actor, item.authorId)) {
    return jsonError(404, "not_found", m.errors.notFound);
  }
  return Response.json({ item: toNewsDto(item, actor) });
}

/** PUT /api/news/[id] — 自分の投稿は NEWS_POST、他人の投稿は NEWS_MANAGE が必要 */
export async function PUT(req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const item = await prisma.news.findUnique({ where: { id } });
  if (!item) return jsonError(404, "not_found", m.errors.notFound);
  if (!canEditNews(actor, item.authorId)) {
    return jsonError(
      403,
      "forbidden",
      actor.has("NEWS_POST") ? m.errors.forbiddenNewsOther : m.errors.forbidden,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = newsSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const v = parsed.data;
  // 楽観的ロックの印。無ければ 400
  const lock = parseEditStamp(body, m);
  if (lock instanceof Response) return lock;

  // 印が合う行だけを更新する。当たらなければ、ほかの人が先に保存している
  const hit = await prisma.news.updateMany({
    where: { id, ...stampWhere(lock) },
    data: {
      titleJa: v.titleJa,
      bodyJa: v.bodyJa,
      titleEn: v.titleEn || null,
      bodyEn: v.bodyEn || null,
      status: v.status,
      pinned: v.pinned,
      publishFrom: parseDateOnly(v.publishFrom),
      publishUntil: parseDateOnly(v.publishUntil),
    },
  });
  if (hit.count === 0) {
    // お知らせは更新者を持たないので、時刻だけ添える
    return staleFromRow(
      m,
      await prisma.news.findUnique({ where: { id }, select: { updatedAt: true } }),
    );
  }

  await writeAudit({
    entity: "news",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { titleJa: v.titleJa, status: v.status },
  });
  const after = await prisma.news.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
  return Response.json({ ok: true, stamp: rowStamp(after) });
}

/** DELETE /api/news/[id] */
export async function DELETE(_req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const item = await prisma.news.findUnique({ where: { id } });
  if (!item) return jsonError(404, "not_found", m.errors.notFound);
  if (!canEditNews(actor, item.authorId)) {
    return jsonError(
      403,
      "forbidden",
      actor.has("NEWS_POST") ? m.errors.forbiddenNewsOther : m.errors.forbidden,
    );
  }

  await prisma.news.delete({ where: { id } });
  await writeAudit({
    entity: "news",
    entityId: id,
    action: "delete",
    actorId: actor.user.id,
    diff: { titleJa: item.titleJa },
  });
  return Response.json({ ok: true });
}
