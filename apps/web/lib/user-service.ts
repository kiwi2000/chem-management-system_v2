import {
  expandPermissions,
  GROUP_PERMISSIONS,
  isPermission,
  type MfaMethod,
  type Permission,
} from "@chem/shared";
import type { PermissionGroupJoinReason, User } from "@prisma/client";
import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { rowStamp } from "@/lib/edit-stamp";
import { getServerMessages } from "@/lib/i18n";
import { chainLabel, defaultGroupIdsFor, type OrgChainNode } from "@/lib/organisation-tree";

/**
 * ユーザーの読み書き。
 * S31 から、人の権限は入っている管理グループで決まる（人に直接付ける権限は無い）。
 * 組織は 1 つで、権限とは関係ない。
 */

export type UserWithGroups = User & {
  permissionGroups: {
    reason: PermissionGroupJoinReason;
    group: {
      id: string;
      code: string;
      nameJa: string;
      nameEn: string | null;
      isSystemAdmin: boolean;
      permissions: { permission: string }[];
      rows: {
        productView: boolean;
        productEdit: boolean;
        compositionView: boolean;
        substanceView: boolean;
        substanceEdit: boolean;
      }[];
    };
  }[];
  _count?: { passkeys: number };
};

/** 一覧・詳細で毎回同じものを読むので共通化する */
export const USER_INCLUDE = {
  permissionGroups: {
    select: {
      reason: true,
      group: {
        select: {
          id: true,
          code: true,
          nameJa: true,
          nameEn: true,
          isSystemAdmin: true,
          permissions: { select: { permission: true } },
          rows: {
            select: {
              productView: true,
              productEdit: true,
              compositionView: true,
              substanceView: true,
              substanceEdit: true,
            },
          },
        },
      },
    },
    orderBy: { group: { code: "asc" } },
  },
  _count: { select: { passkeys: true } },
} as const;

/**
 * 入っている管理グループから、その人の権限を求める（一覧の表示用。判定は authz.ts の Actor で行う）
 */
function permissionsOf(u: UserWithGroups): Permission[] {
  if (u.permissionGroups.some((m) => m.group.isSystemAdmin)) return [];
  const set = new Set<Permission>();
  for (const { group } of u.permissionGroups) {
    for (const { permission } of group.permissions) {
      if (isPermission(permission) && GROUP_PERMISSIONS.includes(permission)) set.add(permission);
    }
    for (const r of group.rows) {
      if (r.productView) set.add("PRODUCT_VIEW");
      if (r.productEdit) set.add("PRODUCT_EDIT");
      if (r.compositionView) set.add("COMPOSITION_VIEW");
      if (r.substanceView) set.add("SUBSTANCE_VIEW");
      if (r.substanceEdit) set.add("SUBSTANCE_EDIT");
    }
  }
  return expandPermissions(set);
}

export function toUserSummary(u: UserWithGroups, orgPaths: Map<string, OrgChainNode[]>) {
  const chain = u.organisationId ? (orgPaths.get(u.organisationId) ?? []) : [];
  const org = chain[0] ?? null;
  const isSystemAdmin = u.permissionGroups.some((m) => m.group.isSystemAdmin);
  return {
    // 楽観的ロックの印（管理者の編集画面が保存時に送り返す）
    stamp: rowStamp(u),
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    activeFlag: u.activeFlag,
    hasPassword: u.passwordHash !== null,
    mfaMethod: (u.mfaMethod as MfaMethod) ?? "none",
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    isSystemAdmin,
    permissions: permissionsOf(u),
    organisationId: org?.id ?? null,
    /** 上からの道筋（「営業部 › 営業1課」） */
    organisationPath: chain.length ? chainLabel(chain) : null,
    groups: u.permissionGroups.map((m) => ({
      id: m.group.id,
      code: m.group.code,
      nameJa: m.group.nameJa,
      nameEn: m.group.nameEn,
      isSystemAdmin: m.group.isSystemAdmin,
      reason: m.reason,
    })),
    // パスキーの数。2要素認証と同じく、入口の守りとして管理者に見せる
    passkeyCount: u._count?.passkeys ?? 0,
  };
}

/**
 * 組織・管理グループの割り当てを検証する。存在しない id は 400（画面から来ない値でも弾く）
 */
export async function resolveAssignments(
  organisationId: string,
  groupIds: string[],
): Promise<{ organisationId: string; groupIds: string[] } | Response> {
  const m = await getServerMessages();
  const org = await prisma.organisation.findFirst({
    where: { id: organisationId, deletedAt: null },
    select: { id: true },
  });
  if (!org) return jsonError(400, "validation_error", m.errors.validation);

  const groups = await prisma.permissionGroup.findMany({
    where: { id: { in: groupIds } },
    select: { id: true },
  });
  if (groups.length !== groupIds.length) {
    return jsonError(400, "validation_error", m.errors.validation);
  }
  return { organisationId, groupIds };
}

/**
 * 入る管理グループを指定の集合に置き換える。
 * 残るものは入った理由をそのまま残す。新しく入るものは、組織の「最初に選ばれる管理グループ」なら
 * DEFAULT、そうでなければ MANUAL。**変わったかどうか**を返す（セッションを切るかの判断に使う）
 */
export async function setGroups(
  userId: string,
  organisationId: string,
  wanted: string[],
  grantedBy: string,
): Promise<boolean> {
  const current = await prisma.userPermissionGroup.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const have = new Set(current.map((r) => r.groupId));
  const next = new Set(wanted);
  const toAdd = wanted.filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !next.has(id));
  if (toAdd.length === 0 && toRemove.length === 0) return false;
  const defaults = new Set(await defaultGroupIdsFor(organisationId));
  await prisma.$transaction([
    ...(toRemove.length
      ? [prisma.userPermissionGroup.deleteMany({ where: { userId, groupId: { in: toRemove } } })]
      : []),
    ...(toAdd.length
      ? [
          prisma.userPermissionGroup.createMany({
            data: toAdd.map((groupId) => ({
              userId,
              groupId,
              grantedBy,
              reason: defaults.has(groupId) ? ("DEFAULT" as const) : ("MANUAL" as const),
            })),
          }),
        ]
      : []),
  ]);
  return true;
}

/** システム管理グループの id */
export async function systemAdminGroupId(): Promise<string | null> {
  const g = await prisma.permissionGroup.findFirst({
    where: { isSystemAdmin: true },
    select: { id: true },
  });
  return g?.id ?? null;
}

/** 有効なシステム管理者の人数（最後の1人を守るために使う） */
export async function countActiveAdmins(excludeUserId?: string): Promise<number> {
  return prisma.userPermissionGroup.count({
    where: {
      group: { isSystemAdmin: true },
      userId: excludeUserId ? { not: excludeUserId } : undefined,
      user: { activeFlag: true, deletedAt: null },
    },
  });
}
