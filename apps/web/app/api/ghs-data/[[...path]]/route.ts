import { jsonError, requireUser } from "@/lib/authz";
import { ghsApi } from "@/lib/ghs/api";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

/**
 * /api/ghs-data/<道筋> — GHS 分類データの一覧・出典ごとの表・自社判定・国ごとの採用順。
 * ログイン済みはここで確かめ、権限は `lib/ghs/data-api.ts` の側で見る（参照は SUBSTANCE_VIEW など）
 */
async function handle(req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { path = [] } = await params;
  const res = await ghsApi(req, ["ghs-data", ...path], actor);
  if (res) return res;
  const m = await getServerMessages();
  return jsonError(404, "not_found", m.errors.notFound);
}

export const GET = handle;
export const PUT = handle;
