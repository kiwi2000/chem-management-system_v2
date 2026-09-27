import { getActor } from "@/lib/authz";
import type { ModulePageProps } from "../../types";
import { GhsReleases } from "../components/ghs-releases";
import { SOURCES } from "../ghs/import-service";
import { sdsMessages } from "../messages";

/** /sds/ghs — GHS 分類データの取り込みと記録 */
export async function SdsGhsPage({ locale }: ModulePageProps) {
  const t = sdsMessages(locale);
  const actor = await getActor();
  const isAdmin = actor?.has("ADMIN") ?? false;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.ghs.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.ghs.lead}</p>
        {!isAdmin && <p className="text-muted-foreground mt-1 text-sm">{t.ghs.import.adminOnly}</p>}
      </div>
      <GhsReleases
        locale={locale}
        isAdmin={isAdmin}
        sources={SOURCES.map((s) => ({
          code: s.code,
          name: locale === "ja" ? s.nameJa : s.nameEn,
        }))}
      />
    </div>
  );
}
