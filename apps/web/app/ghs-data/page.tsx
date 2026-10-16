import { ForbiddenNotice } from "@/components/forbidden-notice";
import { GhsDataPage } from "@/components/ghs/ghs-data-page";
import { getActor } from "@/lib/authz";
import { getLocale } from "@/lib/i18n";

/** GHS分類データ。参照は SUBSTANCE_VIEW、自社判定は SUBSTANCE_EDIT、取り込みと採用順は ADMIN（各 API でも確かめる） */
export default async function GhsDataRoute() {
  const actor = await getActor();
  if (!actor?.has("SUBSTANCE_VIEW")) return <ForbiddenNotice />;
  return <GhsDataPage locale={await getLocale()} />;
}
