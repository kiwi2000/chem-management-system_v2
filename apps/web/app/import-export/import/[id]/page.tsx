import { ImportJobScreen } from "@/components/import-job-screen";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";

/** 取り込み 1 件。概要 → インポート → 一時領域の確認 → 反映（決定 0011） */
export default async function ImportJobPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor?.has("DATA_IMPORT")) return <ForbiddenNotice />;
  const { id } = await params;
  return <ImportJobScreen id={id} />;
}
