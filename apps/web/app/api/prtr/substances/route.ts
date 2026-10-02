import { requirePermission } from "@/lib/authz";
import { searchPrtrSubstances } from "@/lib/prtr-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/prtr/substances?code=&cas=&name= — 実測値の区画の「物質検索」（S22。2026-10-02 設計）。
 * コードの一部・CAS（完全一致）・名称の一部で物質を探し、化管法の第一種指定化学物質に当たるものだけを返す。
 * 所属によらない（誰が呼んでも同じもの）ので、所属の確認は要らない。条件が空なら空
 */
export async function GET(req: Request) {
  const actor = await requirePermission("PRTR_ENTRY");
  if (actor instanceof Response) return actor;
  const url = new URL(req.url);
  const q = {
    code: (url.searchParams.get("code") ?? "").trim(),
    cas: (url.searchParams.get("cas") ?? "").trim(),
    name: (url.searchParams.get("name") ?? "").trim(),
  };
  const { items, truncated } = await searchPrtrSubstances(q, 20);
  return Response.json({ items, truncated });
}
