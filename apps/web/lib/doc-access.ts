import type { DocumentTarget } from "@chem/shared";
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

/** 一覧・zip の where。自分のものか、権限があれば他人のものも（見せてよいものだけ） */
export async function documentWhere(actor: Actor): Promise<Prisma.GeneratedDocumentWhereInput> {
  const composition = actor.has("COMPOSITION_VIEW") ? {} : { hasComposition: false };
  if (!actor.has("DOCUMENT_VIEW_ALL")) return { generatedBy: actor.user.id, ...composition };
  const hidden = await hiddenTargetIds(actor);
  return {
    ...composition,
    ...(hidden.length > 0 ? { targetRef: { notIn: hidden } } : {}),
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
