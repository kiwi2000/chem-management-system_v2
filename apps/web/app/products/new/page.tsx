import { ProductForm } from "@/components/product-form";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PROPERTY_DEF_COUNT, toPropertyDefDto } from "@/lib/property-def-service";
import { getAppSettings } from "@/lib/settings";

/** 製品の新規登録。型式・用途の選択肢はシステム設定に持つので、サーバー側で読んで渡す */
export default async function NewProductPage() {
  const [m, actor, settings, defs] = await Promise.all([
    getServerMessages(),
    getActor(),
    getAppSettings(),
    prisma.propertyDef.findMany({
      where: { target: "PRODUCT", activeFlag: true },
      orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
      include: PROPERTY_DEF_COUNT,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 lg:p-6">
      <h1 className="text-2xl font-semibold">{m.products.newTitle}</h1>
      <ProductForm
        defs={defs.map(toPropertyDefDto)}
        modelOptions={settings.productModelOptions}
        useOptions={settings.productUseOptions}
        canEdit={actor?.has("PRODUCT_EDIT") ?? false}
        settings={settings}
      />
    </div>
  );
}
