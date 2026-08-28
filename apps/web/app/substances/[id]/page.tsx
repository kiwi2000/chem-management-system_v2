import { pickName } from "@chem/shared";
import { notFound } from "next/navigation";
import { ApprovalHistory } from "@/components/approval-history";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { PublishActions } from "@/components/publish-actions";
import { SubstanceForm } from "@/components/substance-form";
import { SubstanceMatrixSection } from "@/components/substance-matrix";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getLocale, getServerMessages } from "@/lib/i18n";
import { PROPERTY_DEF_COUNT, toPropertyDefDto } from "@/lib/property-def-service";
import { getAppSettings } from "@/lib/settings";
import { buildSubstanceMatrix } from "@/lib/substance-matrix";
import { listNumbers } from "@/lib/substance-numbers";
import {
  SUBSTANCE_INCLUDE,
  canEditSubstance,
  toDetail,
  visibilityWhere,
} from "@/lib/substance-service";

/**
 * 物質の詳細。
 * まず読み取り専用で見せ、「編集」ボタンを押してから書き換えられるようにする。
 * システム設定は管理者しか読めないので、この画面ではサーバー側で読んで必要な値だけ渡す。
 * 項目定義は「使わない」にしたものも含めて渡す（入力済みの値が消えて見えないようにするため）。
 */
export default async function SubstanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 可視性の条件に actor が要るので、先に解決してから残りをまとめて取る
  const actor = await getActor();
  const [m, locale, settings, item, defs] = await Promise.all([
    getServerMessages(),
    getLocale(),
    getAppSettings(),
    prisma.substance.findFirst({
      where: { id, deletedAt: null, ...(actor ? visibilityWhere(actor) : {}) },
      include: SUBSTANCE_INCLUDE,
    }),
    prisma.propertyDef.findMany({
      where: { target: "SUBSTANCE" },
      orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
      include: PROPERTY_DEF_COUNT,
    }),
  ]);

  if (!item) notFound();
  const canEdit = actor ? canEditSubstance(actor, item) : false;
  /*
    各種番号と、バージョンを横に並べた表。
    どちらもCASをたどって引くので、物質が決まってからでないと取れない
  */
  const [numbers, matrix] = await Promise.all([
    listNumbers(item.casNormalized),
    buildSubstanceMatrix(item.casNormalized),
  ]);

  return (
    <div className={PAGE_SHELL_STACKED}>
      <Breadcrumbs
        items={[
          { label: m.nav.substances, href: "/substances" },
          { label: pickName(locale, item.nameJa, item.nameEn) || item.code },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{m.substances.detailTitle}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <PublishActions
            entity="substances"
            id={item.id}
            publishState={item.publishState}
            approvalRequired={settings.substanceApprovalRequired}
            canEdit={canEdit}
            canApprove={actor?.has("APPROVE") ?? false}
          />
        </div>
      </div>
      <SubstanceForm
        initial={toDetail(item)}
        defs={defs.map(toPropertyDefDto)}
        settings={settings}
        canEdit={canEdit}
        numbers={numbers}
      />

      <SubstanceMatrixSection data={matrix} />

      <ApprovalHistory entity="substance" entityId={item.id} />
    </div>
  );
}
