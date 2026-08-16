import { SubstanceForm } from "@/components/substance-form";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PROPERTY_DEF_COUNT, toPropertyDefDto } from "@/lib/property-def-service";
import { getAppSettings } from "@/lib/settings";

/**
 * 物質の新規登録。
 * システム設定は管理者しか読めないので、この画面ではサーバー側で読んで必要な値だけ渡す。
 */
export default async function NewSubstancePage() {
  const [m, actor, settings, defs] = await Promise.all([
    getServerMessages(),
    getActor(),
    getAppSettings(),
    prisma.propertyDef.findMany({
      where: { target: "SUBSTANCE", activeFlag: true },
      orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
      include: PROPERTY_DEF_COUNT,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.substances.newTitle}</h1>
      <SubstanceForm
        defs={defs.map(toPropertyDefDto)}
        settings={settings}
        canEdit={actor?.has("SUBSTANCE_EDIT") ?? false}
      />
    </div>
  );
}
