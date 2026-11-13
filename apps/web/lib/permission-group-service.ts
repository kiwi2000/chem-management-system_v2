import {
  expandPermissions,
  GROUP_PERMISSIONS,
  hasAnyMark,
  isPermission,
  linkMarks,
  normalizeCode,
  PERMISSION_MARKS,
  type Permission,
  type PermissionGroupInput,
} from "@chem/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rowStamp } from "@/lib/edit-stamp";
import { orgPathMap, chainLabel } from "@/lib/organisation-tree";
import type { PermissionGroupDetailDto, PermissionGroupListItemDto } from "@/lib/types";

/**
 * 管理グループ（S31 仕様 5・6 章、画面設計 2・3 章）の読み書き。
 */

const LIST_SELECT = {
  id: true,
  code: true,
  nameJa: true,
  nameEn: true,
  isSystemAdmin: true,
  _count: { select: { members: true, products: true, substances: true } },
  rows: {
    select: { target: { select: { id: true, code: true, nameJa: true, nameEn: true } } },
    orderBy: { target: { code: "asc" } },
  },
} satisfies Prisma.PermissionGroupSelect;

/** 一覧の行（全部。管理グループは多くても数十なので、絞り込み・並べ替えは呼ぶ側がメモリで行う） */
export async function listPermissionGroups(): Promise<PermissionGroupListItemDto[]> {
  const rows = await prisma.permissionGroup.findMany({
    select: LIST_SELECT,
    orderBy: [{ isSystemAdmin: "desc" }, { code: "asc" }],
  });
  return rows.map((g) => ({
    id: g.id,
    code: g.code,
    nameJa: g.nameJa,
    nameEn: g.nameEn,
    isSystemAdmin: g.isSystemAdmin,
    memberCount: g._count.members,
    productCount: g._count.products,
    substanceCount: g._count.substances,
    targets: g.rows.map((r) => r.target),
  }));
}

/** 詳細（表・別の権限・入っている人） */
export async function loadPermissionGroup(id: string): Promise<PermissionGroupDetailDto | null> {
  const g = await prisma.permissionGroup.findUnique({
    where: { id },
    include: {
      rows: {
        include: { target: { select: { id: true, code: true, nameJa: true, nameEn: true } } },
        orderBy: { target: { code: "asc" } },
      },
      permissions: { select: { permission: true } },
      members: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              displayName: true,
              activeFlag: true,
              deletedAt: true,
              organisationId: true,
            },
          },
        },
        orderBy: { user: { email: "asc" } },
      },
    },
  });
  if (!g) return null;
  const paths = await orgPathMap();
  // 自分の行を先頭に
  const rows = [...g.rows].sort(
    (a, b) => Number(b.targetGroupId === g.id) - Number(a.targetGroupId === g.id),
  );
  return {
    stamp: rowStamp(g),
    id: g.id,
    code: g.code,
    nameJa: g.nameJa,
    nameEn: g.nameEn,
    isSystemAdmin: g.isSystemAdmin,
    rows: rows.map((r) => ({
      targetGroupId: r.targetGroupId,
      targetCode: r.target.code,
      targetNameJa: r.target.nameJa,
      targetNameEn: r.target.nameEn,
      ...Object.fromEntries(PERMISSION_MARKS.map((k) => [k, r[k]])),
    })) as PermissionGroupDetailDto["rows"],
    permissions: expandPermissions(
      g.permissions.map((p) => p.permission).filter(isPermission),
    ).filter((p) => GROUP_PERMISSIONS.includes(p)),
    members: g.members
      .filter((m) => m.user.deletedAt === null)
      .map((m) => {
        const chain = m.user.organisationId ? (paths.get(m.user.organisationId) ?? []) : [];
        return {
          userId: m.user.id,
          email: m.user.email,
          displayName: m.user.displayName,
          activeFlag: m.user.activeFlag,
          organisationPath: chain.length ? chainLabel(chain) : null,
          reason: m.reason,
        };
      }),
  };
}

/**
 * 表の行を正規化する。連動の印を補い（仕様 6-2）、印が全部外れた行と、
 * 存在しない・システム管理グループを相手にした行と、同じ相手の 2 行目は落とす
 */
export async function normalizeRows(
  rows: PermissionGroupInput["rows"],
): Promise<PermissionGroupInput["rows"]> {
  const ids = [...new Set(rows.map((r) => r.targetGroupId))];
  const valid = new Set(
    (
      await prisma.permissionGroup.findMany({
        where: { id: { in: ids }, isSystemAdmin: false },
        select: { id: true },
      })
    ).map((g) => g.id),
  );
  const seen = new Set<string>();
  const out: PermissionGroupInput["rows"] = [];
  for (const r of rows) {
    if (!valid.has(r.targetGroupId) || seen.has(r.targetGroupId)) continue;
    seen.add(r.targetGroupId);
    const linked = linkMarks(r);
    if (!hasAnyMark(linked)) continue;
    out.push({ ...linked, targetGroupId: r.targetGroupId });
  }
  return out;
}

/** 表とは別の権限を正規化する（含意を補い、管理グループに付けないものを落とす） */
export function normalizeGroupPermissions(perms: Permission[]): Permission[] {
  return expandPermissions(perms).filter((p) => GROUP_PERMISSIONS.includes(p));
}

/** 表と別の権限を丸ごと入れ替える書き込み（トランザクションの中で使う） */
export function replaceRowsAndPermissions(
  groupId: string,
  rows: PermissionGroupInput["rows"],
  permissions: Permission[],
): Prisma.PrismaPromise<unknown>[] {
  return [
    prisma.permissionGroupRow.deleteMany({ where: { groupId } }),
    prisma.permissionGroupRow.createMany({
      data: rows.map((r) => ({
        groupId,
        targetGroupId: r.targetGroupId,
        ...Object.fromEntries(PERMISSION_MARKS.map((k) => [k, r[k]])),
      })),
    }),
    prisma.permissionGroupPermission.deleteMany({ where: { groupId } }),
    prisma.permissionGroupPermission.createMany({
      data: permissions.map((permission) => ({ groupId, permission })),
    }),
  ];
}

/** コードの正規化（全体で一意。trim＋大文字化） */
export function groupCode(raw: string): string {
  return normalizeCode(raw);
}
