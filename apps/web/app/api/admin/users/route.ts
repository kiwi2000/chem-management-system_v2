import { emptyTableState, normalizeEmail, parseTableState, userCreateSchema } from "@chem/shared";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { jsonError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { USER_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";
import { setPermissions, toUserSummary } from "@/lib/user-service";

export const dynamic = "force-dynamic";

/** 既定はメールアドレス順 */
const DEFAULT_STATE = emptyTableState([{ column: "email", direction: "asc" }]);

/** GET /api/admin/users — ユーザー一覧 */
export async function GET(req: Request) {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const state = parseTableState(
    new URL(req.url).searchParams,
    USER_COLUMNS.map((c) => ({ key: c.key, kind: c.kind })),
    DEFAULT_STATE,
  );
  const where = { deletedAt: null, ...buildWhere(USER_COLUMNS, state.filters) };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: buildOrderBy(USER_COLUMNS, state.sort, { email: "asc" }),
      include: { permissions: { select: { permission: true } } },
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return Response.json({
    items: users.map(toUserSummary),
    total,
    page: state.page,
    pageSize: state.pageSize,
  });
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
