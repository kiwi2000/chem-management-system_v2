import { expandPermissions, isPermission } from "@chem/shared";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { PermissionGroupOptionsDto } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/permission-groups/options — 人の画面で権限グループを選ぶための一覧（S31）。
 * 組織ごとの「最初に選ばれる権限グループ」も一緒に返す（画面が組織の上下をたどって合わせる）
 */
export async function GET() {
  const actor = await requireAdmin();
  if (actor instanceof Response) return actor;

  const [groups, defaults] = await Promise.all([
    prisma.permissionGroup.findMany({
      orderBy: [{ isSystemAdmin: "desc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        nameJa: true,
        nameEn: true,
        isSystemAdmin: true,
        permissions: { select: { permission: true } },
      },
    }),
    prisma.organisationDefaultGroup.findMany({
      where: { group: { isSystemAdmin: false } },
      select: { organisationId: true, groupId: true },
    }),
  ]);

  const orgDefaults: Record<string, string[]> = {};
  for (const d of defaults) (orgDefaults[d.organisationId] ??= []).push(d.groupId);

  const body: PermissionGroupOptionsDto = {
    groups: groups.map((g) => ({
      id: g.id,
      code: g.code,
      nameJa: g.nameJa,
      nameEn: g.nameEn,
      isSystemAdmin: g.isSystemAdmin,
      // お知らせの分類を選べるか（投稿できるか）
      canPost:
        g.isSystemAdmin ||
        expandPermissions(g.permissions.map((p) => p.permission).filter(isPermission)).includes(
          "NEWS_POST",
        ),
    })),
    orgDefaults,
  };
  return Response.json(body);
}
