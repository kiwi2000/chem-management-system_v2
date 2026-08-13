import { expandPermissions, type Permission } from "@chem/shared";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * ユーザーと権限の読み書き。
 * 権限は含意を展開してから保存するので、判定側は単純な所属チェックで済む。
 */

export type UserWithPermissions = User & { permissions: { permission: Permission }[] };

export function toUserSummary(u: UserWithPermissions) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    activeFlag: u.activeFlag,
    hasPassword: u.passwordHash !== null,
    mfaEnabled: u.mfaEnabled,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    permissions: u.permissions.map((p) => p.permission),
  };
}

/** 権限を指定の集合に置き換える（含意を展開したうえで差分だけ書く） */
export async function setPermissions(
  userId: string,
  wanted: Permission[],
  grantedBy: string,
): Promise<Permission[]> {
  const next = expandPermissions(wanted);
  const current = (
    await prisma.userPermission.findMany({ where: { userId }, select: { permission: true } })
  ).map((r) => r.permission);

  const toAdd = next.filter((p) => !current.includes(p));
  const toRemove = current.filter((p) => !next.includes(p));

  await prisma.$transaction([
    ...(toRemove.length
      ? [prisma.userPermission.deleteMany({ where: { userId, permission: { in: toRemove } } })]
      : []),
    ...(toAdd.length
      ? [
          prisma.userPermission.createMany({
            data: toAdd.map((permission) => ({ userId, permission, grantedBy })),
          }),
        ]
      : []),
  ]);
  return next;
}

/** 有効なシステム管理者の人数（最後の1人を守るために使う） */
export async function countActiveAdmins(excludeUserId?: string): Promise<number> {
  return prisma.userPermission.count({
    where: {
      permission: "ADMIN",
      userId: excludeUserId ? { not: excludeUserId } : undefined,
      user: { activeFlag: true, deletedAt: null },
    },
  });
}
