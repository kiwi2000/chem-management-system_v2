import { emptyTableState, newsSchema, parseTableState } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { jsonError, requirePermission, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { NEWS_COLUMNS } from "@/lib/list-columns";
import {
  addressedToWhere,
  checkNewsOrganisations,
  NEWS_INCLUDE,
  newsOrgChain,
  parseDateOnly,
  publishedNowWhere,
  toNewsDto,
} from "@/lib/news-service";
import { flattenOrgTree } from "@/lib/org-tree";
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
 * 見えるのは、宛先が全員か、自分の組織かその上の組織宛てのもの（2026-11-11）。
 * 下書きは、その投稿を編集できる人にしか見せない。お知らせを管理できる人には全部見える（ホームは宛先どおり）。
 * ?scope=home を付けると掲載中のものだけを返す（ホーム用・並べ替えやフィルターは効かない）。
 */
export async function GET(req: Request) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const params = new URL(req.url).searchParams;
  const chainIds = (await newsOrgChain(actor)).map((o) => o.id);
  if (params.get("scope") === "home") {
    // ホームは、管理する人にも宛先どおりのものだけを出す
    const items = await prisma.news.findMany({
      where: { ...publishedNowWhere(new Date()), ...addressedToWhere(chainIds) },
      orderBy: [{ pinned: "desc" }, { publishFrom: "desc" }, { updatedAt: "desc" }],
      include: NEWS_INCLUDE,
      take: HOME_LIMIT,
    });
    // 差出元ごとの見出しで区切って出すので、差出元を組織の木の順（上から）に並べ直す。
    // 中の順は上の並びのまま。差出元の無いもの（「その他のお知らせ」）は最後
    const orgs = await prisma.organisation.findMany({
      select: { id: true, parentId: true, displayOrder: true, nameJa: true },
    });
    const order = new Map(flattenOrgTree(orgs).map((x, i) => [x.org.id, i]));
    const rank = (id: string | null) => (id ? (order.get(id) ?? orgs.length) : orgs.length + 1);
    const sorted = [...items].sort(
      (a, b) => rank(a.fromOrganisationId) - rank(b.fromOrganisationId),
    );
    return Response.json({ items: sorted.map((n) => toNewsDto(n, actor)) });
  }

  const state = parseTableState(
    params,
    NEWS_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );

  // 下書きと宛先の外のものは、その投稿を編集できる人にしか見せない。
  // 最上位に AND を使わない（buildWhere の AND に上書きされるため）
  const visible = actor.has("NEWS_MANAGE")
    ? {}
    : {
        OR: [
          { authorId: actor.user.id },
          { status: "PUBLISHED" as const, ...addressedToWhere(chainIds) },
        ],
      };

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
  // 差出元・宛先は、自分の組織かその上から。「全員」は管理する人だけ
  const chainIds = (await newsOrgChain(actor)).map((o) => o.id);
  if (chainIds.length === 0) return jsonError(400, "no_organisation", m.news.noOrganisation);
  const bad = checkNewsOrganisations(actor, chainIds, v, null, m.news);
  if (bad) return jsonError(400, "validation_error", bad);

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
      fromOrganisationId: v.fromOrganisationId,
      toOrganisationId: v.toOrganisationId,
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
