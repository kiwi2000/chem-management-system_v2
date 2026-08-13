import { normalizeEmail, userCreateSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { setPermissions, toUserSummary } from "@/lib/user-service";

export const dynamic = "force-dynamic";

/** GET /api/admin/users — ユーザー一覧 */
export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: { permissions: { select: { permission: true } } },
  });
  return Response.json({ items: users.map(toUserSummary) });
}

/** POST /api/admin/users — ユーザー作成（初期パスワードを発行し、初回ログイン時に変更を強制） */
export async function POST(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", m.errors.invalidJson);
  }
  const parsed = userCreateSchema(m).safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "validation_error", m.errors.validation, parsed.error.flatten());
  }
  const { email, displayName, permissions, initialPassword } = parsed.data;
  const normalized = normalizeEmail(email);

  if (await prisma.user.findUnique({ where: { email: normalized } })) {
    return jsonError(409, "email_taken", m.errors.emailTaken);
  }

  const created = await prisma.user.create({
    data: {
      email: normalized,
      displayName: displayName ?? null,
      passwordHash: await hashPassword(initialPassword),
      mustChangePassword: true,
    },
  });
  const granted = await setPermissions(created.id, permissions, actor.user.id);

  await writeAudit({
    entity: "users",
    entityId: created.id,
    action: "create",
    actorId: actor.user.id,
    diff: { email: normalized, permissions: granted },
  });
  return Response.json({ id: created.id, permissions: granted }, { status: 201 });
}
