import { notFound } from "next/navigation";
import { CompositionEditor } from "@/components/composition-editor";
import { DraftToggle } from "@/components/draft-toggle";
import { ProductForm } from "@/components/product-form";
import { getActor } from "@/lib/authz";
import { canViewComposition } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRODUCT_INCLUDE, canEditProduct, toDetail, visibilityWhere } from "@/lib/product-service";
import { PROPERTY_DEF_COUNT, toPropertyDefDto } from "@/lib/property-def-service";
import { getAppSettings } from "@/lib/settings";

/**
 * 製品の詳細。
 * まず読み取り専用で見せ、「編集」ボタンを押してから書き換えられるようにする。
 * 非公開の製品は、権限が無ければ 404（存在ごと隠す）。
 * 項目定義は「使わない」にしたものも含めて渡す（入力済みの値が消えて見えないようにするため）。
 * 組成は行数が多くなるので、製品本体とは別に保存する。
 */
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) notFound();

  const [m, settings, item, defs] = await Promise.all([
    getServerMessages(),
    getAppSettings(),
    prisma.product.findFirst({
      where: { id, deletedAt: null, ...visibilityWhere(actor) },
      include: PRODUCT_INCLUDE,
    }),
    prisma.propertyDef.findMany({
      where: { target: "PRODUCT" },
      orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
      include: PROPERTY_DEF_COUNT,
    }),
  ]);

  if (!item) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{m.products.detailTitle}</h1>
        <DraftToggle
          entity="products"
          id={item.id}
          draftFlag={item.draftFlag}
          canEdit={canEditProduct(actor, item)}
        />
      </div>
      <ProductForm
        initial={toDetail(item)}
        defs={defs.map(toPropertyDefDto)}
        modelOptions={settings.productModelOptions}
        useOptions={settings.productUseOptions}
        canEdit={canEditProduct(actor, item)}
        composition={
          /* 非開示の組成は、そもそもこの節ごと出さない */
          canViewComposition(actor, item) ? (
            <CompositionEditor productId={item.id} settings={settings} />
          ) : (
            <p className="text-muted-foreground text-sm">{m.composition.withheld}</p>
          )
        }
      />
    </div>
  );
}
