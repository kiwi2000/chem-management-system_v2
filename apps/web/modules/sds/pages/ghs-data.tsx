import { getActor } from "@/lib/authz";
import type { ModulePageProps } from "../../types";
import { GhsDataTable } from "../components/ghs-data-table";
import { sdsMessages } from "../messages";

/** /sds/ghs-data — 物質 × 採用した GHS 分類の一覧。自社判定の登録と、国ごとの出典の採用順 */
export async function SdsGhsDataPage({ locale }: ModulePageProps) {
  const t = sdsMessages(locale);
  const actor = await getActor();
  // 見るのは物質を見られる人。中身は API 側でも同じ権限で確かめる
  if (!actor?.has("SUBSTANCE_VIEW")) return null;
  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.data.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.data.lead}</p>
      </div>
      <GhsDataTable
        locale={locale}
        canEdit={actor.has("SUBSTANCE_EDIT")}
        isAdmin={actor.has("ADMIN")}
      />
    </div>
  );
}
