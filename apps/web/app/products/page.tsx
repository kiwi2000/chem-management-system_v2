import { ProductsTable } from "./products-table";
import { getAppSettings } from "@/lib/settings";

/**
 * 製品 / 原材料の一覧。
 * 型式・用途の選択肢はシステム設定にあるので、ここで読んで一覧へ渡す
 * （設定APIは管理者専用なので、画面から直接は読めない）。
 */
export default async function ProductsPage() {
  const settings = await getAppSettings();
  return (
    <ProductsTable
      modelOptions={settings.productModelOptions}
      useOptions={settings.productUseOptions}
    />
  );
}
