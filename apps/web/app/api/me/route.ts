import { canEdit, isPrivileged, requireUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

/** GET /api/me — ログイン中ユーザーの表示用情報（UIの出し分けに使う。認可はサーバーで別途強制する） */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;
  return Response.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    canEdit: canEdit(user),
    privileged: isPrivileged(user),
    preferredLocale: user.preferredLocale,
  });
}
