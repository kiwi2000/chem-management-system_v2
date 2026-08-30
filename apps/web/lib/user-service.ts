import { expandPermissions, type MfaMethod, type Permission } from "@chem/shared";
import type { Group, Organisation, User } from "@prisma/client";
import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

/**
 * ユーザーと権限の読み書き。
 * 権限は含意を展開してから保存するので、判定側は単純な所属チェックで済む。
 */

export type UserWithPermissions = User & {
  permissions: { permission: Permission }[];
  department?: Pick<Organisation, "id" | "nameJa" | "nameEn"> | null;
  newsGroup?: Pick<Group, "id" | "nameJa" | "nameEn"> | null;
  organisation?: Pick<Organisation, "id" | "nameJa" | "nameEn"> | null;
  _count?: { passkeys: number };
};

/** 一覧・詳細で毎回同じものを読むので共通化する */
export const USER_INCLUDE = {
  permissions: { select: { permission: true } },
  department: { select: { id: true, nameJa: true, nameEn: true } },
  newsGroup: { select: { id: true, nameJa: true, nameEn: true } },
  organisation: { select: { id: true, nameJa: true, nameEn: true } },
  _count: { select: { passkeys: true } },
} as const;

export function toUserSummary(u: UserWithPermissions) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    activeFlag: u.activeFlag,
    hasPassword: u.passwordHash !== null,
    mfaMethod: (u.mfaMethod as MfaMethod) ?? "none",
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    permissions: u.permissions.map((p) => p.permission),
    departmentId: u.departmentId,
    departmentName: u.department?.nameJa ?? null,
    departmentNameEn: u.department?.nameEn ?? null,
    newsGroupId: u.newsGroupId,
    newsGroupName: u.newsGroup?.nameJa ?? null,
    newsGroupNameEn: u.newsGroup?.nameEn ?? null,
    organisationId: u.organisationId,
    organisationName: u.organisation?.nameJa ?? null,
    organisationNameEn: u.organisation?.nameEn ?? null,
    // パスキーの数。2要素認証と同じく、入口の守りとして管理者に見せる
    passkeyCount: u._count?.passkeys ?? 0,
  };
}

/**
 * グループの割り当てを検証して、そのまま Prisma へ渡せる形にする。
 *
 * - 存在しないID・用途が違うID は 400（画面から来ない値でも弾く）
 * - お知らせの分類は「お知らせを投稿できる」人だけが持てる。
 *   権限を外したのに分類だけ残ると、投稿できないのに見出しが割り当たった状態になるため
 */
export async function resolveGroups(
  departmentId: string | null,
  newsGroupId: string | null,
  wantedPermissions: Permission[],
  organisationId: string | null = null,
): Promise<
  | { departmentId: string | null; newsGroupId: string | null; organisationId: string | null }
  | Response
> {
  const m = await getServerMessages();
  const canPost = expandPermissions(wantedPermissions).includes("NEWS_POST");
  const news = canPost ? newsGroupId : null;

  if (news) {
    const found = await prisma.group.findFirst({
      where: { id: news, deletedAt: null },
      select: { kind: true },
    });
    if (found?.kind !== "NEWS") return jsonError(400, "validation_error", m.errors.validation);
  }

  /*
    会社と部署は、どちらも組織。**種別まで確かめる。**
    消された組織のidが残ると帳票の差出人が空になり、
    種別が違うものを入れると「部署の欄に取引先」といった並びになる
  */
  const wanted: [string | null, "COMPANY" | "DEPARTMENT"][] = [
    [organisationId, "COMPANY"],
    [departmentId, "DEPARTMENT"],
  ];
  const ids = wanted.map(([id]) => id).filter((v): v is string => v !== null);
  if (ids.length > 0) {
    const found = await prisma.organisation.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, kind: true },
    });
    const kindOf = new Map(found.map((o) => [o.id, o.kind]));
    for (const [id, kind] of wanted) {
      if (id && kindOf.get(id) !== kind) {
        return jsonError(400, "validation_error", m.errors.validation);
      }
    }
  }
  return { departmentId, newsGroupId: news, organisationId };
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
