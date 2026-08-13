import { canEdit, requireUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

/** GET /api/me — ログイン中ユーザーの表示用情報（UIの出し分けに使う。認可はサーバーで別途強制する） */
export async function GET() {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  const { user, permissions } = actor;
  return Response.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    permissions,
    canEdit: canEdit(actor),
    isAdmin: actor.has("ADMIN"),
    preferredLocale: user.preferredLocale,
  });
}
