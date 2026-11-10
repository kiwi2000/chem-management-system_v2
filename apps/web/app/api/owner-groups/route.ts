import { requireUser } from "@/lib/authz";
import { ownerChoices } from "@/lib/owner-group";
import type { OwnerChoicesDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/owner-groups?for=product|substance — 作る・移す・取り込むときに選べる所属先（S31 仕様 7 章）。
 * 「編集」の印を持つ権限グループだけ。システム管理グループの人は全部（自動では決めず、必ず選ばせる）
 */
export async function GET(req: Request) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const target = new URL(req.url).searchParams.get("for") === "substance" ? "substance" : "product";
  const items = await ownerChoices(actor, target === "substance" ? "substanceEdit" : "productEdit");
  const body: OwnerChoicesDto = {
    items,
    // 1 つしか選べない人は自動で決まる。システム管理グループの人は必ず選ぶ
    autoPick: !actor.isSystemAdmin && items.length === 1 ? (items[0]?.id ?? null) : null,
  };
  return Response.json(body);
}
