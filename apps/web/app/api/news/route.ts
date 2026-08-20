import { emptyTableState, newsSchema, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { NEWS_COLUMNS } from "@/lib/list-columns";
import { NEWS_INCLUDE, parseDateOnly, publishedNowWhere, toNewsDto } from "@/lib/news-service";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

export const dynamic = "force-dynamic";

/** ホームに出す件数の上限。分類ごとに見出しを付けるので、5件では足りない */
const HOME_LIMIT = 30;

/** 既定は重要なものを先に、次に掲載開始日の新しい順 */
const DEFAULT_STATE = emptyTableState([
  { column: "pinned", direction: "desc" },
  { column: "publishFrom", direction: "desc" },
]);

/**
 * GET /api/news — お知らせ一覧。
 * 閲覧は全ログインユーザー。ただし下書きは、その投稿を編集できる人にしか見せない。
 * ?scope=home を付けると掲載中のものだけを返す（ホーム用・並べ替えやフィルターは効かない）。
 */
export async function GET(req: Request) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const params = new URL(req.url).searchParams;
  if (params.get("scope") === "home") {
    // 分類ごとの見出しで区切って出すので、まず分類の表示順で並べる。
    // 分類なしは Postgres の既定どおり最後に来る（「その他のお知らせ」の位置）。
    const items = await prisma.news.findMany({
      where: publishedNowWhere(new Date()),
      orderBy: [
        { group: { displayOrder: "asc" } },
        { pinned: "desc" },
        { publishFrom: "desc" },
        { updatedAt: "desc" },
      ],
      include: NEWS_INCLUDE,
      take: HOME_LIMIT,
    });
    return Response.json({ items: items.map((n) => toNewsDto(n, actor)) });
  }

  const state = parseTableState(
    params,
    NEWS_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  // 下書きは、その投稿を編集できる人にしか見せない
  const visible = actor.has("NEWS_MANAGE")
    ? {}
    : { OR: [{ status: "PUBLISHED" as const }, { authorId: actor.user.id }] };

  const where = { ...visible, ...buildWhere(NEWS_COLUMNS, state.filters) };

  const [items, total] = await Promise.all([
    prisma.news.findMany({
      where,
      orderBy: buildOrderBy(NEWS_COLUMNS, state.sort, { updatedAt: "desc" }),
      include: NEWS_INCLUDE,
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.news.count({ where }),
  ]);

  return Response.json({
    items: items.map((n) => toNewsDto(n, actor)),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
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
      // 投稿時点の分類を写し取る。後で異動しても過去の投稿は動かない
      groupId: actor.user.newsGroupId,
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
