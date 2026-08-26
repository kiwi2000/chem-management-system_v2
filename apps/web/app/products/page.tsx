import { getLocale } from "@/lib/i18n";
import { listJudgementCategoryOptions } from "@/lib/judgement-category-options";
import { getAppSettings } from "@/lib/settings";
import { ProductsLists } from "./products-lists";

/**
 * 製品 / 原材料の一覧。
 * 型式・用途の選択肢と承認の要否はシステム設定にあるので、ここで読んで画面へ渡す
 * （設定APIは管理者専用なので、画面から直接は読めない）。
 *
 * 「該当法規制」の選択肢も、判定を持っている区分だけをここで読んで渡す。
 */
export default async function ProductsPage() {
  const [settings, locale] = await Promise.all([getAppSettings(), getLocale()]);
  const judgementCategories = await listJudgementCategoryOptions(locale);
  return (
    <ProductsLists
      modelOptions={settings.productModelOptions}
      useOptions={settings.productUseOptions}
      approvalRequired={settings.productApprovalRequired}
      judgementCategories={judgementCategories}
    />
  );
}
