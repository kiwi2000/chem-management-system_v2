import { requireAnyPermission } from "@/lib/authz";
import { newsChoices, newsOrgChain } from "@/lib/news-service";
import type { NewsOrganisationChoicesDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/news/organisations — お知らせの差出元・宛先に選べる組織（2026-11-11）。
 * 投稿する人の組織と、その上の組織（上から順）。「全員」は管理する人だけ選べる。
 * 無効にした組織は出さない（2026-11-12）。自分の組織が無効なら、最初に選ばれるのはその上でいちばん近い有効な組織
 */
export async function GET() {
  const actor = await requireAnyPermission("NEWS_POST", "NEWS_MANAGE");
  if (actor instanceof Response) return actor;

  const chain = newsChoices(await newsOrgChain(actor));
  const body: NewsOrganisationChoicesDto = {
    choices: [...chain].reverse().map((o) => ({ id: o.id, nameJa: o.nameJa, nameEn: o.nameEn })),
    ownId: chain[0]?.id ?? null,
    canAll: actor.has("NEWS_MANAGE"),
  };
  return Response.json(body);
}
