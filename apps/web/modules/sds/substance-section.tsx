import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { todayInJapan } from "@/lib/judgement-date";
import type { ModuleSubstanceSectionProps } from "../types";
import { SubstanceGhsSectionView } from "./components/substance-ghs-section";
import { classificationsForCas, listGhsClasses } from "./ghs/query";

/**
 * 物質の詳細に差し込む「GHS 分類（出どころ別）」。今日の日付で有効な項目を、物質の CAS で引く。
 * CAS が無い物質、取り込みが無い CAS では何も出さない。
 * 採用の結果と自社判定（判定修正）は画面側が API から引く（§9-5）
 */
export async function SdsGhsSubstanceSection({
  substanceId,
  casNormalized,
  locale,
}: ModuleSubstanceSectionProps) {
  if (!casNormalized) return null;
  const asOf = todayInJapan();
  const blocks = await classificationsForCas(casNormalized, asOf);
  if (blocks.length === 0) return null;
  const [classes, actor, substance] = await Promise.all([
    listGhsClasses(),
    getActor(),
    prisma.substance.findUnique({ where: { id: substanceId }, select: { code: true } }),
  ]);
  if (!substance) return null;
  return (
    <SubstanceGhsSectionView
      locale={locale}
      blocks={blocks}
      classes={classes}
      substanceId={substanceId}
      substanceCode={substance.code}
      canEdit={actor?.has("SUBSTANCE_EDIT") ?? false}
    />
  );
}
