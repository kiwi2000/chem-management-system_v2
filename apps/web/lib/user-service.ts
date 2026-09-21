import { expandPermissions, isPermission, type MfaMethod, type Permission } from "@chem/shared";
import type { Group, Organisation, Permission as DbPermission, User } from "@prisma/client";
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
  /** DB の enum のまま。画面へ出すときに、知らない値（古い DOCUMENT_SENDER）は落とす */
  permissions: { permission: DbPermission }[];
  newsGroup?: Pick<Group, "id" | "nameJa" | "nameEn"> | null;
  /** 所属する組織。種別を問わず何件でも */
  organisations?: { organisation: OrganisationRef }[];
  /** PRTR の担当（S22）。当面は 0 か 1 件 */
  prtrScopes?: {
    siteId: string | null;
    groupId: string | null;
    site: { nameJa: string } | null;
    group: { nameJa: string } | null;
  }[];
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
  prtrScopes: {
    select: {
      siteId: true,
      groupId: true,
      site: { select: { nameJa: true } },
      group: { select: { nameJa: true } },
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
    permissions: u.permissions.map((p) => p.permission).filter(isPermission),
    newsGroupId: u.newsGroupId,
    newsGroupName: u.newsGroup?.nameJa ?? null,
    newsGroupNameEn: u.newsGroup?.nameEn ?? null,
    // 組織の表示順に並べて返す。画面はこの順で出し、先頭が「会社」「部署」の代表になる
    organisations: sortOrganisations((u.organisations ?? []).map((x) => x.organisation)).map(
      (o) => ({ id: o.id, kind: o.kind, nameJa: o.nameJa, nameEn: o.nameEn }),
    ),
    // パスキーの数。2要素認証と同じく、入口の守りとして管理者に見せる
    passkeyCount: u._count?.passkeys ?? 0,
    prtrScope: (() => {
      const s = u.prtrScopes?.[0];
      if (!s) return null;
      return {
        siteId: s.siteId,
        siteName: s.site?.nameJa ?? null,
        groupId: s.groupId,
        groupName: s.group?.nameJa ?? null,
      };
    })(),
  };
}

/**
 * PRTR の担当（S22）を、権限に照らして確かめる。
 * 管理者は担当を持たない。グループ担当にはグループ、工場担当には工場が要る。
 * PRTR の権限が無い人の担当は捨てる（残しておくと、あとで権限を付けたときに古い担当が効く）
 */
export async function resolvePrtrScope(
  scope: { siteId?: string | null; groupId?: string | null } | null | undefined,
  wantedPermissions: Permission[],
): Promise<{ siteId: string | null; groupId: string | null } | null | Response> {
  const m = await getServerMessages();
  const granted = expandPermissions(wantedPermissions);
  const siteId = scope?.siteId ?? null;
  const groupId = scope?.groupId ?? null;
  if (granted.includes("PRTR_ADMIN")) {
    if (siteId || groupId) {
      return jsonError(400, "validation_error", m.users.prtrScopeAdminHasNone);
    }
    return null;
  }
  if (granted.includes("PRTR_GROUP")) {
    if (!groupId) return jsonError(400, "validation_error", m.users.prtrScopeGroupRequired);
    const found = await prisma.prtrGroup.count({ where: { id: groupId, deletedAt: null } });
    if (found === 0) return jsonError(400, "validation_error", m.errors.validation);
    return { siteId: null, groupId };
  }
  if (granted.includes("PRTR_SITE")) {
    if (!siteId) return jsonError(400, "validation_error", m.users.prtrScopeSiteRequired);
    const found = await prisma.prtrSite.count({ where: { id: siteId, deletedAt: null } });
    if (found === 0) return jsonError(400, "validation_error", m.errors.validation);
    return { siteId, groupId: null };
  }
  return null;
}

/** 担当を置き換える。**当面は 1 人 1 行**（複数にするときは画面だけ直す） */
export async function setPrtrScope(
  userId: string,
  scope: { siteId: string | null; groupId: string | null } | null,
): Promise<void> {
  await prisma.$transaction([
    prisma.prtrUserScope.deleteMany({ where: { userId } }),
    ...(scope
      ? [
          prisma.prtrUserScope.create({
            data: { userId, siteId: scope.siteId, groupId: scope.groupId },
          }),
        ]
      : []),
  ]);
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
  // DB の enum にだけ残っている古い値は、無いものとして扱う（次の保存で消える）
  const current = (
    await prisma.userPermission.findMany({ where: { userId }, select: { permission: true } })
  )
    .map((r) => r.permission)
    .filter(isPermission);

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
