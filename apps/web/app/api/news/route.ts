import { newsSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { parseDateOnly, publishedNowWhere, toNewsDto } from "@/lib/news-service";

export const dynamic = "force-dynamic";

const AUTHOR_SELECT = { select: { id: true, displayName: true, email: true } };

/**
 * GET /api/news — お知らせ一覧。
 * 閲覧は全ログインユーザー。ただし下書きは、その投稿を編集できる人にしか見せない。
 * ?scope=home を付けると掲載中のものだけを返す（ホーム用）。
 */
export async function GET(req: Request) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const scope = new URL(req.url).searchParams.get("scope");
  const canSeeAllDrafts = actor.has("NEWS_MANAGE");

  const where =
    scope === "home"
      ? publishedNowWhere(new Date())
      : canSeeAllDrafts
        ? {}
        : // 公開済み＋自分の下書き
          { OR: [{ status: "PUBLISHED" as const }, { authorId: actor.user.id }] };

  const items = await prisma.news.findMany({
    where,
    orderBy: [{ pinned: "desc" }, { publishFrom: "desc" }, { updatedAt: "desc" }],
    include: { author: AUTHOR_SELECT },
    take: scope === "home" ? 5 : 200,
  });
  return Response.json({ items: items.map((n) => toNewsDto(n, actor)) });
}

/** POST /api/news — お知らせの投稿 */
export async function POST(req: Request) {
  const actor = await requirePermission("NEWS_POST");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

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

  const created = await prisma.news.create({
    data: {
      titleJa: v.titleJa,
      bodyJa: v.bodyJa,
      titleEn: v.titleEn || null,
      bodyEn: v.bodyEn || null,
      status: v.status,
      pinned: v.pinned,
      publishFrom: parseDateOnly(v.publishFrom),
      publishUntil: parseDateOnly(v.publishUntil),
      authorId: actor.user.id,
    },
  });

  await writeAudit({
    entity: "news",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { titleJa: v.titleJa, status: v.status },
  });
  return Response.json({ id: created.id }, { status: 201 });
}
