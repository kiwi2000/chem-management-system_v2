import { getAppSettings } from "@/lib/settings";
import { ProductsLists } from "./products-lists";

/**
 * 製品 / 原材料の一覧。
 * 型式・用途の選択肢と承認の要否はシステム設定にあるので、ここで読んで画面へ渡す
 * （設定APIは管理者専用なので、画面から直接は読めない）。
 */
export default async function ProductsPage() {
  const settings = await getAppSettings();
  return (
    <ProductsLists
      modelOptions={settings.productModelOptions}
      useOptions={settings.productUseOptions}
      approvalRequired={settings.productApprovalRequired}
    />
  );
}
