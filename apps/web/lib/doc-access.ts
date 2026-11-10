import { targetIsList, type DocumentTarget } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { compositionAccessMany } from "@/lib/composition-access";
import { prisma } from "@/lib/db";
import { visibilityWhere as productVisibility } from "@/lib/product-service";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";

/**
 * 発行済みドキュメントを誰に見せるか。
 *
 * **一覧に並べる**（2026-09-16 指示）
 * - 自分が作ったもの … いつも並ぶ
 * - 他の人が作ったもの … 「他の人が作ったドキュメントも見られる」（DOCUMENT_VIEW_ALL）があるときだけ
 *
 * **開く・落とす・消す**（S31 仕様 10 章「ドキュメント」・画面設計 11 章）
 * - **見られない情報を含む帳票は、作った本人も含めて誰も開けない。**
 *   載せた製品・物質がその人に全部見え、組成が載っていれば、その製品の組成も見えること
 * - 開けない帳票も一覧には並べ、「開けません」と出す（名前・対象・作った人・日時は見える。決定 5）
 * - S31 より前に作った一覧の帳票は、何を載せたかの記録が無いので、作った本人とシステム管理グループだけが開ける
 *
 * 生成状況（仕事）は権限に関係なく、いつも自分のぶんだけ
 */

/** 開けるかを決めるのに要る項目（呼ぶ側の select に混ぜる） */
export const DOC_ACCESS_SELECT = {
  generatedBy: true,
  hasComposition: true,
  targetRef: true,
  contentProductIds: true,
  contentSubstanceIds: true,
  template: { select: { target: true } },
} satisfies Prisma.GeneratedDocumentSelect;

export interface DocAccessFields {
  generatedBy: string | null;
  hasComposition: boolean;
  targetRef: string;
  contentProductIds: string[];
  contentSubstanceIds: string[];
  template: { target: DocumentTarget };
}

/** 一覧に並べる帳票の where。自分のものか、権限があれば他人のものも */
export async function documentWhere(actor: Actor): Promise<Prisma.GeneratedDocumentWhereInput> {
  if (actor.isSystemAdmin || actor.has("DOCUMENT_VIEW_ALL")) return {};
  return { generatedBy: actor.user.id };
}

/** 一覧に並ぶ帳票か（documentWhere と同じ）。消すときもこれで確かめる */
export function canListDocument(actor: Actor, doc: { generatedBy: string | null }): boolean {
  return listed(actor, doc);
}

function listed(actor: Actor, doc: { generatedBy: string | null }): boolean {
  return actor.isSystemAdmin || actor.has("DOCUMENT_VIEW_ALL") || doc.generatedBy === actor.user.id;
}

/** その帳票に載せた製品・物質 */
function contentOf(doc: DocAccessFields): { products: string[]; substances: string[] } | null {
  const t = doc.template.target;
  if (t === "PRODUCT") return { products: [doc.targetRef], substances: [] };
  if (t === "SUBSTANCE") return { products: [], substances: [doc.targetRef] };
  if (targetIsList(t)) {
    // 記録が無い（S31 より前に作った）一覧の帳票は、中身が分からない
    if (doc.contentProductIds.length === 0 && doc.contentSubstanceIds.length === 0) return null;
    return { products: doc.contentProductIds, substances: doc.contentSubstanceIds };
  }
  // 組織・規制区分・対象なしは、誰でも見られるものしか載らない
  return { products: [], substances: [] };
}

/**
 * 帳票ごとに、中身がその人に全部見えるか（開けるか）。まとめて求める
 */
export async function openableDocuments(
  actor: Actor,
  docs: (DocAccessFields & { id: string })[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (actor.isSystemAdmin) {
    for (const d of docs) out.add(d.id);
    return out;
  }
  const contents = new Map(docs.map((d) => [d.id, contentOf(d)]));
  const productIds = [...new Set([...contents.values()].flatMap((c) => c?.products ?? []))];
  const substanceIds = [...new Set([...contents.values()].flatMap((c) => c?.substances ?? []))];
  const [products, substances] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({
          where: { id: { in: productIds }, deletedAt: null, ...productVisibility(actor) },
          select: { id: true },
        })
      : [],
    substanceIds.length
      ? prisma.substance.findMany({
          where: { id: { in: substanceIds }, deletedAt: null, ...substanceVisibility(actor) },
          select: { id: true },
        })
      : [],
  ]);
  const visibleP = new Set(products.map((p) => p.id));
  const visibleS = new Set(substances.map((s) => s.id));
  const needComposition = [
    ...new Set(
      docs.filter((d) => d.hasComposition).flatMap((d) => contents.get(d.id)?.products ?? []),
    ),
  ];
  const composition = await compositionAccessMany(actor, needComposition);

  for (const d of docs) {
    const c = contents.get(d.id);
    if (!c) {
      // 中身の記録が無い一覧の帳票: 作った本人だけ
      if (d.generatedBy === actor.user.id) out.add(d.id);
      continue;
    }
    const ok =
      c.products.every((id) => visibleP.has(id)) &&
      c.substances.every((id) => visibleS.has(id)) &&
      (!d.hasComposition || c.products.every((id) => composition.get(id) !== "hidden"));
    if (ok) out.add(d.id);
  }
  return out;
}

/** 1 件を見せてよいか（開く・落とす・消す）。一覧に並び、中身が全部見えること */
export async function canAccessDocument(
  actor: Actor,
  doc: DocAccessFields & { id: string },
): Promise<boolean> {
  if (!listed(actor, doc)) return false;
  return (await openableDocuments(actor, [doc])).has(doc.id);
}

/**
 * 開く・落とすを許すか（2026-09-17 指示）。
 *
 * **自分が作ったものは、作れる人なら開けて落とせる。**
 * 作った本人が成果を確かめられないと、作る権限そのものが役に立たない。
 * 他の人が作ったものを開く・落とすには「ドキュメントを開ける・落とせる」が要る
 * （中身が見えるかは canAccessDocument が決める）
 */
export function canOpenDocument(actor: Actor, doc: { generatedBy: string | null }): boolean {
  return doc.generatedBy === actor.user.id || actor.has("DOCUMENT_DOWNLOAD");
}

/** 作った人の表示名。一覧の「作成者」の列に出す */
export async function creatorNames(userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((v): v is string => v !== null))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.displayName ?? u.email]));
}

/**
 * 帳票に記録する、載せた製品・物質（S31）。1 件の帳票は相手そのもの、一覧の帳票は載せた全部
 */
export function contentIdsFor(
  target: DocumentTarget,
  targetRef: string,
  data: { productIds?: string[]; substanceIds?: string[] },
): { contentProductIds: string[]; contentSubstanceIds: string[] } {
  if (target === "PRODUCT") return { contentProductIds: [targetRef], contentSubstanceIds: [] };
  if (target === "SUBSTANCE") return { contentProductIds: [], contentSubstanceIds: [targetRef] };
  return {
    contentProductIds: data.productIds ?? [],
    contentSubstanceIds: data.substanceIds ?? [],
  };
}
