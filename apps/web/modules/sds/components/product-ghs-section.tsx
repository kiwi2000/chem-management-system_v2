import type { ModuleProductSectionProps } from "../../types";
import { ProductGhsSectionView } from "./product-ghs-section-view";

/**
 * 製品の詳細に差し込む「GHS 判定（日本）」（SDS 版。S27 §5 の 4）。
 * 結果は API から引く（保存してある判定。無ければ「判定する」で計算）。いまは日本（JP）のレイヤーだけ
 */
export function ProductGhsSection({
  productId,
  locale,
  canEdit,
  canViewComposition,
}: ModuleProductSectionProps) {
  return (
    <ProductGhsSectionView
      productId={productId}
      locale={locale}
      country="JP"
      canEdit={canEdit}
      canViewComposition={canViewComposition}
    />
  );
}
