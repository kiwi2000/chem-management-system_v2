import { getAppSettings } from "@/lib/settings";
import { SubstancesLists } from "./substances-lists";

/**
 * 物質マスタの一覧。
 * 承認の要否はシステム設定にあるので、ここで読んで画面へ渡す
 * （設定APIは管理者専用なので、画面から直接は読めない）。
 */
export default async function SubstancesPage() {
  const settings = await getAppSettings();
  return <SubstancesLists approvalRequired={settings.substanceApprovalRequired} />;
}
