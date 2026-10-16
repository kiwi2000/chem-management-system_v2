import { jsonError, requireUser } from "@/lib/authz";
import { ghsApi } from "@/lib/ghs/api";
import { getServerMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

/**
 * /api/ghs/<道筋> — GHS 分類データの取り込み（POST import）と記録（GET releases）。
 * ログイン済みはここで確かめ、権限は `lib/ghs/api.ts` の側で見る（取り込みは管理者だけ）
 */
async function handle(req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { path = [] } = await params;
  const res = await ghsApi(req, ["ghs", ...path], actor);
  if (res) return res;
  const m = await getServerMessages();
  return jsonError(404, "not_found", m.errors.notFound);
}

export const GET = handle;
export const POST = handle;
