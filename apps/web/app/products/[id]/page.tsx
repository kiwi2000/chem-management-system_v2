import { notFound } from "next/navigation";
import { ApprovalHistory } from "@/components/approval-history";
import { PublishActions } from "@/components/publish-actions";
import { ProductForm } from "@/components/product-form";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import { getActor } from "@/lib/authz";
import { ProductJudgements } from "@/components/product-judgements";
import { canEditComposition, canViewComposition } from "@/lib/composition-service";
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

  const [m, settings, item, defs, linkVersion] = await Promise.all([
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
    // 判定に使っている法規制のバージョン。見出しに添える
    prisma.linkSetVersion.findFirst({
      where: { isCurrent: true, deletedAt: null },
      select: { code: true },
    }),
  ]);

  if (!item) notFound();

  return (
    <div className={PAGE_SHELL_STACKED}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{m.products.detailTitle}</h1>
        <PublishActions
          entity="products"
          id={item.id}
          publishState={item.publishState}
          approvalRequired={settings.productApprovalRequired}
          canEdit={canEditProduct(actor, item)}
          canApprove={actor.has("APPROVE")}
        />
      </div>
      <ProductForm
        initial={toDetail(item)}
        defs={defs.map(toPropertyDefDto)}
        modelOptions={settings.productModelOptions}
        useOptions={settings.productUseOptions}
        canEdit={canEditProduct(actor, item)}
        /* 非開示の組成は、そもそもこの節ごと出さない */
        canViewComposition={canViewComposition(actor, item)}
        settings={settings}
        /* 組成と備考のあいだに挟む。組成を見ながら考えたいので */
        afterComposition={
          <ProductJudgements
            productId={item.id}
            canEdit={canEditComposition(actor, item)}
            version={linkVersion?.code ?? null}
          />
        }
      />

      <ApprovalHistory entity="product" entityId={item.id} />
    </div>
  );
}
