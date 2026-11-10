/**
 * 組織の木（S31）。画面とサーバーの両方で使う、DB に触らない計算だけを置く。
 * 上下は「上の組織」（parentId）だけで持つ。
 */

export interface OrgTreeInput {
  id: string;
  parentId: string | null;
  displayOrder: number;
  nameJa: string;
}

/** 輪になった誤ったデータでも止まるように */
const MAX_DEPTH = 32;

/**
 * 木を上から順に並べたもの（深さ付き）。同じ上の組織の中は表示順、同じなら名前の順。
 * 上の組織が一覧に無いもの（消された・読めない）は、いちばん上に並べる
 */
export function flattenOrgTree<T extends OrgTreeInput>(orgs: T[]): { org: T; depth: number }[] {
  const ids = new Set(orgs.map((o) => o.id));
  const children = new Map<string | null, T[]>();
  for (const o of orgs) {
    const key = o.parentId && ids.has(o.parentId) ? o.parentId : null;
    const list = children.get(key) ?? [];
    list.push(o);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.displayOrder - b.displayOrder || a.nameJa.localeCompare(b.nameJa, "ja"));
  }
  const out: { org: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const o of children.get(parent) ?? []) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      out.push({ org: o, depth });
      walk(o.id, depth + 1);
    }
  };
  walk(null, 0);
  // 輪になっていて上から届かなかったものも落とさない
  for (const o of orgs) if (!seen.has(o.id)) out.push({ org: o, depth: 0 });
  return out;
}

/** その組織から上へたどった id（自分が先頭） */
export function ancestorIds<T extends OrgTreeInput>(orgs: T[], id: string | null): string[] {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const out: string[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur && !out.includes(cur.id) && out.length < MAX_DEPTH) {
    out.push(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return out;
}

/** その組織の下にある組織の id（自分は含まない）。上の組織に自分の下を選ばせないために使う */
export function descendantIds<T extends OrgTreeInput>(orgs: T[], id: string): Set<string> {
  const out = new Set<string>();
  let frontier = [id];
  for (let depth = 0; frontier.length > 0 && depth < MAX_DEPTH; depth++) {
    const next: string[] = [];
    for (const o of orgs) {
      if (o.parentId && frontier.includes(o.parentId) && !out.has(o.id) && o.id !== id) {
        out.add(o.id);
        next.push(o.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** 「営業部 › 営業1課」のような上からの道筋 */
export function orgPathLabel<T extends OrgTreeInput>(
  orgs: T[],
  id: string | null,
  name: (o: T) => string = (o) => o.nameJa,
): string {
  const byId = new Map(orgs.map((o) => [o.id, o]));
  return ancestorIds(orgs, id)
    .reverse()
    .map((x) => {
      const o = byId.get(x);
      return o ? name(o) : "";
    })
    .join(" › ");
}
