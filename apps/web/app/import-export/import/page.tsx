import { ImportScreen } from "@/components/import-screen";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/** インポート。ファイルを上げて、取り込みの履歴を見る（決定 0011） */
export default async function ImportPage() {
  const actor = await getActor();
  if (!actor?.has("DATA_IMPORT")) return <ForbiddenNotice />;
  return <ImportScreen />;
}
