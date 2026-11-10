import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rowStamp } from "@/lib/edit-stamp";
import type { OrganisationDto } from "@/lib/types";

/**
 * 組織（会社・事業所）。帳票に載せる差出人の情報。
 *
 * 項目は**まるごと入れ替える。**1件ずつ足し引きすると、
 * 画面で消した行がサーバーに伝わらず、消したはずのものが帳票に出る。
 */

/** 一覧・詳細で共通に引くもの */
export const ORG_INCLUDE = {
  items: { orderBy: [{ displayOrder: "asc" }, { label: "asc" }] },
  _count: { select: { members: true } },
} satisfies Prisma.OrganisationInclude;

type Row = Prisma.OrganisationGetPayload<{ include: typeof ORG_INCLUDE }>;

export function toOrganisationDto(row: Row): OrganisationDto {
  return {
    stamp: rowStamp(row),
    id: row.id,
    code: row.code,
    kind: row.kind,
    kindLabel: row.kindLabel,
    nameJa: row.nameJa,
    nameEn: row.nameEn,
    displayOrder: row.displayOrder,
    activeFlag: row.activeFlag,
    parentId: row.parentId,
    items: row.items.map((x) => ({ label: x.label, value: x.value })),
    // この組織に所属する人の数。消したときの影響を知らせるため
    memberCount: row._count.members,
  };
}

/**
 * 帳票で使える会社の項目名。**すべての組織を通した重複なしの並び。**
 *
 * テンプレートは会社を名指ししない（出した人の会社が使われる）ので、
 * 選べる項目もどれか1社に絞らず、登録されているものを全部出す。
 * 出した人の会社にその項目が無ければ、そこは空欄になる。
 */
export async function orgItemLabels(): Promise<string[]> {
  const rows = await prisma.organisationItem.findMany({
    where: { organisation: { deletedAt: null } },
    select: { label: true },
    distinct: ["label"],
    orderBy: { label: "asc" },
  });
  return rows.map((x) => x.label);
}

/**
 * 上の組織として選べるか（S31）。消された組織・自分・自分の下の組織は選べない（輪になるため）
 */
export async function validParent(
  selfId: string | null,
  parentId: string | null,
): Promise<boolean> {
  if (!parentId) return true;
  if (parentId === selfId) return false;
  const parent = await prisma.organisation.findFirst({
    where: { id: parentId, deletedAt: null },
    select: { id: true },
  });
  if (!parent) return false;
  if (!selfId) return true;
  // 上の組織をたどって自分に当たれば、自分の下を選んでいる
  let cur: string | null = parentId;
  for (let i = 0; cur && i < 64; i++) {
    if (cur === selfId) return false;
    const row: { parentId: string | null } | null = await prisma.organisation.findUnique({
      where: { id: cur },
      select: { parentId: true },
    });
    cur = row?.parentId ?? null;
  }
  return true;
}

/**
 * 最初に選ばれる権限グループを入れ替える（S31 仕様 8 章）。システム管理グループは選べないので落とす
 */
export async function setDefaultGroups(organisationId: string, groupIds: string[]): Promise<void> {
  const valid = await prisma.permissionGroup.findMany({
    where: { id: { in: [...new Set(groupIds)] }, isSystemAdmin: false },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.organisationDefaultGroup.deleteMany({ where: { organisationId } }),
    prisma.organisationDefaultGroup.createMany({
      data: valid.map((g) => ({ organisationId, groupId: g.id })),
    }),
  ]);
}

/** 組織ごとの最初に選ばれる権限グループ（管理者に返す一覧のため） */
export async function defaultGroupsByOrg(): Promise<Map<string, string[]>> {
  const rows = await prisma.organisationDefaultGroup.findMany({
    select: { organisationId: true, groupId: true },
  });
  const out = new Map<string, string[]>();
  for (const r of rows)
    out.set(r.organisationId, [...(out.get(r.organisationId) ?? []), r.groupId]);
  return out;
}
