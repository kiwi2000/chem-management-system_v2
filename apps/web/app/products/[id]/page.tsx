import { notFound } from "next/navigation";
import { ProductForm } from "@/components/product-form";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { PRODUCT_INCLUDE, toDetail, visibilityWhere } from "@/lib/product-service";
import { PROPERTY_DEF_COUNT, toPropertyDefDto } from "@/lib/property-def-service";

/**
 * 製品の詳細。
 * まず読み取り専用で見せ、「編集」ボタンを押してから書き換えられるようにする。
 * 非公開の製品は、権限が無ければ 404（存在ごと隠す）。
 * 項目定義は「使わない」にしたものも含めて渡す（入力済みの値が消えて見えないようにするため）。
 */
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) notFound();

  const [m, item, defs] = await Promise.all([
    getServerMessages(),
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
      <h1 className="text-2xl font-semibold">{m.products.detailTitle}</h1>
      <ProductForm
        initial={toDetail(item)}
        defs={defs.map(toPropertyDefDto)}
        canEdit={actor.has("PRODUCT_EDIT")}
        canSetPrivate={actor.has("PRODUCT_VIEW_PRIVATE")}
        canSetCompositionPublic={actor.has("COMPOSITION_VIEW_PRIVATE")}
      />
    </div>
  );
}
