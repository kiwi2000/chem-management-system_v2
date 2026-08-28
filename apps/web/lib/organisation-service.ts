import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
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
    id: row.id,
    code: row.code,
    nameJa: row.nameJa,
    nameEn: row.nameEn,
    displayOrder: row.displayOrder,
    activeFlag: row.activeFlag,
    items: row.items.map((x) => ({ label: x.label, value: x.value })),
    // この会社に属している人の数。消したときの影響を知らせるため
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
