import { newsSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { canEditNews, parseDateOnly, toNewsDto } from "@/lib/news-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const AUTHOR_SELECT = { select: { id: true, displayName: true, email: true } };

/** GET /api/news/[id] — 下書きは編集できる人だけが読める */
export async function GET(_req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { id } = await params;
  const m = await getServerMessages();

  const item = await prisma.news.findUnique({ where: { id }, include: { author: AUTHOR_SELECT } });
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

  await prisma.news.update({
    where: { id },
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

  await writeAudit({
    entity: "news",
    entityId: id,
    action: "update",
    actorId: actor.user.id,
    diff: { titleJa: v.titleJa, status: v.status },
  });
  return Response.json({ ok: true });
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
