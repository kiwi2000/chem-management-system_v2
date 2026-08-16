import { ProductForm } from "@/components/product-form";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PROPERTY_DEF_COUNT, toPropertyDefDto } from "@/lib/property-def-service";

/** 製品の新規登録。機密フラグを触れるかは権限で決まるので、サーバー側で解決して渡す */
export default async function NewProductPage() {
  const [m, actor, defs] = await Promise.all([
    getServerMessages(),
    getActor(),
    prisma.propertyDef.findMany({
      where: { target: "PRODUCT", activeFlag: true },
      orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
      include: PROPERTY_DEF_COUNT,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.products.newTitle}</h1>
      <ProductForm
        defs={defs.map(toPropertyDefDto)}
        canEdit={actor?.has("PRODUCT_EDIT") ?? false}
        canSetPrivate={actor?.has("PRODUCT_VIEW_PRIVATE") ?? false}
        canSetCompositionPublic={actor?.has("COMPOSITION_VIEW_PRIVATE") ?? false}
      />
    </div>
  );
}
