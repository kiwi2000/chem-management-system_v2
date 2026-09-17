import { targetIsList, type DocumentTarget } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { visibilityWhere as productVisibility } from "@/lib/product-service";
import { visibilityWhere as substanceVisibility } from "@/lib/substance-service";

/**
 * 発行済みドキュメントを誰に見せるか（2026-09-16 指示）。
 *
 * - 自分が作ったもの … いつも見える
 * - 他の人が作ったもの … 「他の人が作ったドキュメントも見られる」（DOCUMENT_VIEW_ALL）があるときだけ
 *
 * どちらでも、**見せてよいものだけ見せる**:
 * - 組成が載っている帳票は、いま組成を見る権限がある人にだけ
 * - 相手（製品・物質）が未公開・無効なら、それを見られる人にだけ（一覧と同じ見える範囲）
 *
 * 落とす・消すも同じ条件。生成状況（仕事）は権限に関係なく、いつも自分のぶんだけ
 */

/** 見えない相手（製品・物質）の ID。未公開を見られない人にだけ要る */
async function hiddenTargetIds(actor: Actor): Promise<string[]> {
  if (actor.has("INACTIVE_VIEW")) return [];
  const [products, substances] = await Promise.all([
    prisma.product.findMany({
      where: { NOT: productVisibility(actor) },
      select: { id: true },
    }),
    prisma.substance.findMany({
      where: { NOT: substanceVisibility(actor) },
      select: { id: true },
    }),
  ]);
  return [...products.map((p) => p.id), ...substances.map((s) => s.id)];
}

const LIST_TARGETS: DocumentTarget[] = ["PRODUCT_LIST", "SUBSTANCE_LIST"];

/** 一覧・zip の where。自分のものか、権限があれば他人のものも（見せてよいものだけ） */
export async function documentWhere(actor: Actor): Promise<Prisma.GeneratedDocumentWhereInput> {
  const composition = actor.has("COMPOSITION_VIEW") ? {} : { hasComposition: false };
  if (!actor.has("DOCUMENT_VIEW_ALL")) return { generatedBy: actor.user.id, ...composition };
  if (actor.has("INACTIVE_VIEW")) return composition;
  const hidden = await hiddenTargetIds(actor);
  return {
    ...composition,
    ...(hidden.length > 0 ? { targetRef: { notIn: hidden } } : {}),
    /*
      一覧の帳票（製品・物質の一覧）は、未公開のものが混ざっていても紙面からは分からない。
      未公開を見られない人には、自分が作ったものだけ
    */
    OR: [{ generatedBy: actor.user.id }, { template: { target: { in: LIST_TARGETS } } }],
  };
}

/** 1 件を見せてよいか（開く・落とす・消す） */
export async function canAccessDocument(
  actor: Actor,
  doc: {
    generatedBy: string | null;
    hasComposition: boolean;
    targetRef: string;
    template: { target: DocumentTarget };
  },
): Promise<boolean> {
  if (doc.hasComposition && !actor.has("COMPOSITION_VIEW")) return false;
  if (doc.generatedBy === actor.user.id) return true;
  if (!actor.has("DOCUMENT_VIEW_ALL")) return false;
  if (actor.has("INACTIVE_VIEW")) return true;
  // 組織・規制区分は誰でも見られ、対象なしは相手が無い
  if (
    doc.template.target === "ORGANISATION" ||
    doc.template.target === "CATEGORY" ||
    doc.template.target === "NONE"
  ) {
    return true;
  }
  // 一覧の帳票は未公開が混ざりうる。未公開を見られない人には見せない（上の documentWhere と同じ）
  if (targetIsList(doc.template.target)) return false;
  const visible =
    doc.template.target === "PRODUCT"
      ? await prisma.product.findFirst({
          where: { id: doc.targetRef, ...productVisibility(actor) },
          select: { id: true },
        })
      : await prisma.substance.findFirst({
          where: { id: doc.targetRef, ...substanceVisibility(actor) },
          select: { id: true },
        });
  return visible !== null;
}

/**
 * 開く・落とすを許すか（2026-09-17 指示）。
 *
 * **自分が作ったものは、作れる人なら開けて落とせる。**
 * 作った本人が成果を確かめられないと、作る権限そのものが役に立たない。
 * 他の人が作ったものを開く・落とすには「ドキュメントを開ける・落とせる」が要る
 * （一覧に並べるかどうかは canAccessDocument / documentWhere が決める）
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
