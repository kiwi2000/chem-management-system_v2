import { requireUser } from "@/lib/authz";
import { getHeaderIcon } from "@/lib/header-icon";

export const dynamic = "force-dynamic";

/**
 * GET /api/app-icon — 題字の横のアイコンそのもの。
 * ログインしている人なら誰でも見られる（帯に出るものなので権限は要らない）。
 * URL に `?v=<預けた時刻>` が付くので、ブラウザに覚えさせてよい（替えると URL が変わる）
 */
export async function GET() {
  const actor = await requireUser({ allowPending: true });
  if (actor instanceof Response) return actor;
  const icon = await getHeaderIcon();
  if (!icon) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(icon.bytes), {
    headers: {
      "Content-Type": icon.mime,
      "Content-Length": String(icon.bytes.byteLength),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
