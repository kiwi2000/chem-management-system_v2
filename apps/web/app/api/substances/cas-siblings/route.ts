import { normalizeCas } from "@chem/shared";
import { casSiblings } from "@/lib/substance-service";
import { requirePermission } from "@/lib/authz";

export const dynamic = "force-dynamic";

/**
 * GET /api/substances/cas-siblings?cas=...&exclude=...
 *
 * 同じCAS番号の、生きている他の物質。物質の登録画面が、
 * 「代表をどちらにしますか」を出すかどうかの判断に使う。
 * 何も返らなければ、その物質が自動で代表になるので、画面は何も聞かない。
 */
export async function GET(req: Request) {
  const actor = await requirePermission("SUBSTANCE_VIEW");
  if (actor instanceof Response) return actor;

  const url = new URL(req.url);
  const raw = url.searchParams.get("cas")?.trim() ?? "";
  if (raw === "") return Response.json({ items: [] });

  const items = await casSiblings(normalizeCas(raw), url.searchParams.get("exclude"));
  return Response.json({ items });
}
