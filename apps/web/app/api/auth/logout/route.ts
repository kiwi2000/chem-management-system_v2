import { getSessionUser, logout } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout — ログアウト（DBのセッション削除＋Cookie破棄） */
export async function POST() {
  const user = await getSessionUser();
  await logout();
  return Response.json({ ok: true, wasLoggedIn: user !== null });
}
