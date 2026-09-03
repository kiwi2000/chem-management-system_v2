import { expandPermissions, type MfaMethod, type Permission } from "@chem/shared";
import type { Group, Organisation, User } from "@prisma/client";
import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { sortOrganisations } from "@/lib/user-organisations";

/**
 * ユーザーと権限の読み書き。
 * 権限は含意を展開してから保存するので、判定側は単純な所属チェックで済む。
 */

type OrganisationRef = Pick<Organisation, "id" | "kind" | "nameJa" | "nameEn" | "displayOrder">;

export type UserWithPermissions = User & {
  permissions: { permission: Permission }[];
  newsGroup?: Pick<Group, "id" | "nameJa" | "nameEn"> | null;
  /** 所属する組織。種別を問わず何件でも */
  organisations?: { organisation: OrganisationRef }[];
  _count?: { passkeys: number };
};

/** 一覧・詳細で毎回同じものを読むので共通化する */
export const USER_INCLUDE = {
  permissions: { select: { permission: true } },
  newsGroup: { select: { id: true, nameJa: true, nameEn: true } },
  organisations: {
    select: {
      organisation: {
        select: { id: true, kind: true, nameJa: true, nameEn: true, displayOrder: true },
      },
    },
  },
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
    newsGroupId: u.newsGroupId,
    newsGroupName: u.newsGroup?.nameJa ?? null,
    newsGroupNameEn: u.newsGroup?.nameEn ?? null,
    // 組織の表示順に並べて返す。画面はこの順で出し、先頭が「会社」「部署」の代表になる
    organisations: sortOrganisations((u.organisations ?? []).map((x) => x.organisation)).map(
      (o) => ({ id: o.id, kind: o.kind, nameJa: o.nameJa, nameEn: o.nameEn }),
    ),
    // パスキーの数。2要素認証と同じく、入口の守りとして管理者に見せる
    passkeyCount: u._count?.passkeys ?? 0,
  };
}

/**
 * グループ・組織の割り当てを検証する。
 *
 * - 存在しないID・用途が違うID は 400（画面から来ない値でも弾く）
 * - お知らせの分類は「お知らせを投稿できる」人だけが持てる。
 *   権限を外したのに分類だけ残ると、投稿できないのに見出しが割り当たった状態になるため
 * - 組織は**種別を問わず何件でも**。消された組織のidだけ弾く
 */
export async function resolveGroups(
  newsGroupId: string | null,
  wantedPermissions: Permission[],
  organisationIds: string[],
): Promise<{ newsGroupId: string | null; organisationIds: string[] } | Response> {
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

  if (organisationIds.length > 0) {
    const found = await prisma.organisation.count({
      where: { id: { in: organisationIds }, deletedAt: null },
    });
    if (found !== organisationIds.length) {
      return jsonError(400, "validation_error", m.errors.validation);
    }
  }
  return { newsGroupId: news, organisationIds };
}

/**
 * 所属する組織を指定の集合に置き換える。
 * まるごと入れ替える（画面で外したものがサーバーに伝わらない、を防ぐ）
 */
export async function setOrganisations(userId: string, ids: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.userOrganisation.deleteMany({ where: { userId } }),
    ...(ids.length
      ? [
          prisma.userOrganisation.createMany({
            data: ids.map((organisationId) => ({ userId, organisationId })),
          }),
        ]
      : []),
  ]);
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
