import { savedFilterSchema } from "@chem/shared";
import { jsonError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toSavedFilterDto } from "@/lib/saved-filter-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/saved-filters?tableKey=chem.table.products
 *
 * 自分のものと、全員に共有されたものを返す。
 * 保存した条件は「どの一覧か」でしか分かれないので、専用の権限は設けない
 * （中身は条件だけで、見られるデータはその一覧の権限で決まる）。
 */
export async function GET(req: Request) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  const tableKey = new URL(req.url).searchParams.get("tableKey")?.trim();
  if (!tableKey) {
    const m = await getServerMessages();
    return jsonError(400, "validation_error", m.errors.validation);
  }

  const items = await prisma.savedFilter.findMany({
    where: { tableKey, OR: [{ ownerId: actor.user.id }, { shared: true }] },
    orderBy: [{ shared: "asc" }, { title: "asc" }],
    include: { owner: { select: { displayName: true, email: true } } },
  });

  return Response.json({ items: items.map((f) => toSavedFilterDto(f, actor.user.id)) });
}

/**
 * POST /api/saved-filters — 同じ画面・同じ名前なら上書きする。
 * 上書きにしているのは、同名が並んでどれが最新か分からなくなるのを防ぐため。
 */
export async function POST(req: Request) {
  const m = await getServerMessages();
  const actor = await requireUser();
  if (actor instanceof Response) return actor;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = savedFilterSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const input = parsed.data;

  const saved = await prisma.savedFilter.upsert({
    where: {
      tableKey_ownerId_title: {
        tableKey: input.tableKey,
        ownerId: actor.user.id,
        title: input.title,
      },
    },
    update: { query: input.query, shared: input.shared },
    create: {
      tableKey: input.tableKey,
      title: input.title,
      query: input.query,
      shared: input.shared,
      ownerId: actor.user.id,
    },
    include: { owner: { select: { displayName: true, email: true } } },
  });

  return Response.json({ item: toSavedFilterDto(saved, actor.user.id) }, { status: 201 });
}
