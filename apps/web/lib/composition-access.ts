import { canOn, type Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";

/**
 * 組成を見られる・直せるか（S31 仕様 10 章）。
 *
 * 見る人の表の、製品の所属先（A）の行の印で決まる。
 * 1. A に「製品・原材料 参照」がある
 * 2. A に「組成 参照」がある（直すなら「組成 編集」）
 * 3. 組成の中身が全部見える
 *    - 並ぶ物質の所属先に「物質 参照」がある
 *    - 並ぶ原材料の所属先に「製品・原材料 参照」と「組成 参照」があり、その原材料の中身も同じ条件で見える（何段でも）
 *
 * 反応前の組成（写し）に並ぶものも、組成の中身として確かめる（反応前の組成も同じ条件で出すため）。
 * システム管理グループの人は、条件に関係なく見て直せる（9 章）。
 */
export type CompositionAccess = "edit" | "view" | "hidden";

interface Node {
  owner: string;
  substances: Set<string>;
  materials: Set<string>;
}

/** 何段までたどるか（輪になった誤ったデータでも止まるように） */
const MAX_DEPTH = 64;

/** 製品ごとの組成の見え方をまとめて求める（一覧・逆引きで 1 件ずつ引かないため） */
export async function compositionAccessMany(
  actor: Actor,
  productIds: string[],
): Promise<Map<string, CompositionAccess>> {
  const out = new Map<string, CompositionAccess>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return out;
  if (actor.scope === "all") {
    for (const id of ids) out.set(id, "edit");
    return out;
  }

  // 組成の木を、段ごとにまとめて読む
  const nodes = new Map<string, Node>();
  const ensure = (id: string, owner = "") => {
    let n = nodes.get(id);
    if (!n) {
      n = { owner, substances: new Set(), materials: new Set() };
      nodes.set(id, n);
    } else if (owner) n.owner = owner;
    return n;
  };
  const substanceIds = new Set<string>();

  // 根の反応前の組成も中身に含める
  const pre = await prisma.productPreReactionLine.findMany({
    where: { productId: { in: ids } },
    select: { productId: true, substanceId: true, childProductId: true },
  });
  for (const l of pre) {
    const n = ensure(l.productId);
    if (l.substanceId) {
      n.substances.add(l.substanceId);
      substanceIds.add(l.substanceId);
    }
    if (l.childProductId) n.materials.add(l.childProductId);
  }

  let frontier = [
    ...new Set([...ids, ...pre.flatMap((l) => (l.childProductId ? [l.childProductId] : []))]),
  ];
  const loaded = new Set<string>();
  for (let depth = 0; frontier.length > 0 && depth < MAX_DEPTH; depth++) {
    const batch = frontier.filter((id) => !loaded.has(id));
    for (const id of batch) loaded.add(id);
    if (batch.length === 0) break;
    const [products, lines] = await Promise.all([
      prisma.product.findMany({
        where: { id: { in: batch } },
        select: { id: true, ownerGroupId: true },
      }),
      prisma.compositionLine.findMany({
        where: { parentProductId: { in: batch } },
        select: { parentProductId: true, substanceId: true, childProductId: true },
      }),
    ]);
    for (const p of products) ensure(p.id, p.ownerGroupId);
    const next: string[] = [];
    for (const l of lines) {
      const n = ensure(l.parentProductId);
      if (l.substanceId) {
        n.substances.add(l.substanceId);
        substanceIds.add(l.substanceId);
      }
      if (l.childProductId) {
        n.materials.add(l.childProductId);
        if (!loaded.has(l.childProductId)) next.push(l.childProductId);
      }
    }
    frontier = [...new Set(next)];
  }

  const substanceOwner = new Map(
    (
      await prisma.substance.findMany({
        where: { id: { in: [...substanceIds] } },
        select: { id: true, ownerGroupId: true },
      })
    ).map((s) => [s.id, s.ownerGroupId]),
  );

  // 中身が全部見えるか（条件 3）。原材料は、その原材料の組成が見えること（条件 1・2・3）まで求める
  const memo = new Map<string, boolean>();
  const contentsVisible = (id: string, path: Set<string>): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (path.has(id)) return false;
    const n = nodes.get(id);
    if (!n) return false;
    path.add(id);
    let ok = true;
    for (const s of n.substances) {
      const owner = substanceOwner.get(s);
      if (!owner || !canOn(actor, "substanceView", owner)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (const mId of n.materials) {
        const m = nodes.get(mId);
        if (
          !m ||
          !m.owner ||
          !canOn(actor, "productView", m.owner) ||
          !canOn(actor, "compositionView", m.owner) ||
          !contentsVisible(mId, path)
        ) {
          ok = false;
          break;
        }
      }
    }
    path.delete(id);
    memo.set(id, ok);
    return ok;
  };

  for (const id of ids) {
    const n = nodes.get(id);
    if (!n || !n.owner || !canOn(actor, "productView", n.owner)) {
      out.set(id, "hidden");
      continue;
    }
    if (!canOn(actor, "compositionView", n.owner) || !contentsVisible(id, new Set())) {
      out.set(id, "hidden");
      continue;
    }
    out.set(id, canOn(actor, "compositionEdit", n.owner) ? "edit" : "view");
  }
  return out;
}

/** 1 件の製品の組成の見え方 */
export async function compositionAccess(
  actor: Actor,
  productId: string,
): Promise<CompositionAccess> {
  return (await compositionAccessMany(actor, [productId])).get(productId) ?? "hidden";
}

/** 組成を見られる製品の id だけを残す（逆引き・出力で使う） */
export async function filterCompositionVisible(
  actor: Actor,
  productIds: string[],
): Promise<Set<string>> {
  const access = await compositionAccessMany(actor, productIds);
  return new Set([...access].filter(([, a]) => a !== "hidden").map(([id]) => id));
}
