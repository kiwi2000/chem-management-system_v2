import type { PermissionMark } from "@chem/shared";
import { canOn, jsonError, type Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";

/**
 * データの所属先（S31 仕様 7 章）。製品・原材料・物質は、1 件ごとに 1 つの権限グループに所属する。
 */

export interface OwnerChoice {
  id: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
}

/**
 * 作るとき・移すときに選べる所属先。「編集」の印を持つ権限グループだけ
 * （製品・原材料なら productEdit、物質なら substanceEdit）。
 * システム管理グループの人は、どの権限グループでも選べる（表が無いため。11-06）。
 * システム管理グループそのものはデータの持ち主にしない（ほかの権限グループの表の相手にならないため）
 */
export async function ownerChoices(actor: Actor, mark: PermissionMark): Promise<OwnerChoice[]> {
  const ids = actor.scope === "all" ? null : [...actor.scope[mark]];
  if (ids && ids.length === 0) return [];
  return prisma.permissionGroup.findMany({
    where: { isSystemAdmin: false, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, code: true, nameJa: true, nameEn: true },
    orderBy: { code: "asc" },
  });
}

/**
 * 作るときの所属先を決める。
 * - 指定があれば、選べる所属先に入っていること（入っていなければ 400）
 * - 指定が無く、選べるのが 1 つなら、それに決める（ふつうの人はほとんどこれ）
 * - 指定が無く、2 つ以上あるとき・システム管理グループの人は、必ず選ばせる（400）
 */
export async function resolveOwnerForCreate(
  actor: Actor,
  mark: PermissionMark,
  requested: string | null | undefined,
): Promise<string | Response> {
  const m = await getServerMessages();
  const choices = await ownerChoices(actor, mark);
  if (requested) {
    if (choices.some((c) => c.id === requested)) return requested;
    return jsonError(400, "owner_not_allowed", m.owner.notAllowed, {
      fieldErrors: { ownerGroupId: [m.owner.notAllowed] },
    });
  }
  if (!actor.isSystemAdmin && choices.length === 1) return (choices[0] as OwnerChoice).id;
  return jsonError(400, "owner_required", m.owner.required, {
    fieldErrors: { ownerGroupId: [m.owner.required] },
  });
}

/**
 * 所属先を移してよいか。今の所属先と移す先の両方に「編集」の印が要る（システム管理グループは印に関係なく移せる）
 */
export function canMoveOwner(
  actor: Actor,
  mark: PermissionMark,
  from: string,
  to: string,
): boolean {
  return canOn(actor, mark, from) && canOn(actor, mark, to);
}

/**
 * TSV の所属先の列（権限グループのコード）を id に直す。無いコードは null
 */
export async function ownerIdsByCode(codes: string[]): Promise<Map<string, string>> {
  const rows = await prisma.permissionGroup.findMany({
    where: { code: { in: codes }, isSystemAdmin: false },
    select: { id: true, code: true },
  });
  return new Map(rows.map((r) => [r.code, r.id]));
}
