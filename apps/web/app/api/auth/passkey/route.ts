import { requireUser } from "@/lib/authz";
import { passkeysOf } from "@/lib/passkey";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/passkey — 自分が登録している端末の一覧。
 * 公開鍵そのものは返さない。画面で要るのは名前と日付だけ。
 */
export async function GET() {
  // 用事そのもの（2要素認証の登録）
  const auth = await requireUser({ allowPending: true });
  if (auth instanceof Response) return auth;

  const items = await passkeysOf(auth.user.id);
  return Response.json({
    items: items.map((p) => ({
      id: p.id,
      deviceLabel: p.deviceLabel,
      createdAt: p.createdAt.toISOString(),
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    })),
  });
}
