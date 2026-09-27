import { jsonError, requireUser } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";
import { SERVER_MODULES } from "@/modules/registry.server.generated";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ module: string; path?: string[] }> };

/**
 * /api/modules/<モジュール名>/<道筋> — モジュール（差込口から入る機能）の API。
 *
 * ログイン済みであることはここで確かめ、権限はモジュールの側で見る（`actor.has(...)`）。
 * 知らないモジュール・無い道筋は 404。モジュールが 1 つも無い版では、何を呼んでも 404
 */
async function handle(req: Request, { params }: Ctx) {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { module: id, path = [] } = await params;
  const mod = SERVER_MODULES.find((m) => m.id === id);
  const res = mod?.api ? await mod.api(req, path, actor) : null;
  if (res) return res;
  const m = await getServerMessages();
  return jsonError(404, "not_found", m.errors.notFound);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
