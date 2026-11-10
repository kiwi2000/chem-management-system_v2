import type { OrganisationKind } from "@chem/shared";
import { prisma } from "@/lib/db";

/**
 * 組織の上下（S31）。人の組織は 1 つで、上の組織をたどって会社などを求める。
 * 上下は「上の組織」の列だけで持つので、たどるのはここに集める。
 */

/** 何段までたどるか。輪になった誤ったデータでも止まるように */
const MAX_DEPTH = 32;

export interface OrgChainNode {
  id: string;
  code: string;
  kind: OrganisationKind;
  nameJa: string;
  nameEn: string | null;
  parentId: string | null;
}

const NODE_SELECT = {
  id: true,
  code: true,
  kind: true,
  nameJa: true,
  nameEn: true,
  parentId: true,
} as const;

/**
 * その組織から上へたどった組織（自分が先頭、いちばん上が最後）。消された組織に当たったらそこで止める
 */
export async function orgChain(organisationId: string | null): Promise<OrgChainNode[]> {
  const out: OrgChainNode[] = [];
  const seen = new Set<string>();
  let id = organisationId;
  while (id && !seen.has(id) && out.length < MAX_DEPTH) {
    seen.add(id);
    const row = await prisma.organisation.findFirst({
      where: { id, deletedAt: null },
      select: NODE_SELECT,
    });
    if (!row) break;
    out.push(row);
    id = row.parentId;
  }
  return out;
}

/** 上へたどった中で、その種別のいちばん近いもの（自分を含む）。無ければ null */
export function nearestOfKind<T extends { kind: OrganisationKind }>(
  chain: T[],
  kind: OrganisationKind,
): T | null {
  return chain.find((o) => o.kind === kind) ?? null;
}

/** 「営業部 › 営業1課」のような上からの道筋（いちばん上の会社は省かない） */
export function chainLabel(chain: { nameJa: string }[]): string {
  return [...chain]
    .reverse()
    .map((o) => o.nameJa)
    .join(" › ");
}

/**
 * 全部の組織の上下を一度に読み、id → 上からの道筋 を作る（一覧で人ごとに引かないため）
 */
export async function orgPathMap(): Promise<Map<string, OrgChainNode[]>> {
  const rows = await prisma.organisation.findMany({
    where: { deletedAt: null },
    select: NODE_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, OrgChainNode[]>();
  for (const r of rows) {
    const chain: OrgChainNode[] = [];
    const seen = new Set<string>();
    let cur: OrgChainNode | undefined = r;
    while (cur && !seen.has(cur.id) && chain.length < MAX_DEPTH) {
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    out.set(r.id, chain);
  }
  return out;
}

/**
 * その組織と上の組織に設定した「最初に選ばれる権限グループ」（仕様 8 章）。
 * システム管理グループは選べないので除く
 */
export async function defaultGroupIdsFor(organisationId: string | null): Promise<string[]> {
  const chain = await orgChain(organisationId);
  if (chain.length === 0) return [];
  const rows = await prisma.organisationDefaultGroup.findMany({
    where: { organisationId: { in: chain.map((o) => o.id) }, group: { isSystemAdmin: false } },
    select: { groupId: true },
  });
  return [...new Set(rows.map((r) => r.groupId))];
}
