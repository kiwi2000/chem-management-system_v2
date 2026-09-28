import { todayInJapan } from "@/lib/judgement-date";
import type { ModuleSubstanceSectionProps } from "../types";
import { SubstanceGhsSectionView } from "./components/substance-ghs-section";
import { classificationsForCas, listGhsClasses } from "./ghs/query";

/**
 * 物質の詳細に差し込む「GHS 分類（出どころ別）」。今日の日付で有効な項目を、物質の CAS で引く。
 * CAS が無い物質、取り込みが無い CAS では何も出さない
 */
export async function SdsGhsSubstanceSection({
  casNormalized,
  locale,
}: ModuleSubstanceSectionProps) {
  if (!casNormalized) return null;
  const asOf = todayInJapan();
  const blocks = await classificationsForCas(casNormalized, asOf);
  if (blocks.length === 0) return null;
  const classes = await listGhsClasses();
  return <SubstanceGhsSectionView locale={locale} blocks={blocks} classes={classes} />;
}
