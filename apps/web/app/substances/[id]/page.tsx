import { notFound } from "next/navigation";
import { SubstanceForm } from "@/components/substance-form";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { toPropertyDefDto } from "@/lib/property-def-service";
import { getAppSettings } from "@/lib/settings";
import { SUBSTANCE_INCLUDE, toDetail } from "@/lib/substance-service";

/**
 * 物質の詳細。
 * まず読み取り専用で見せ、「編集」ボタンを押してから書き換えられるようにする。
 * システム設定は管理者しか読めないので、この画面ではサーバー側で読んで必要な値だけ渡す。
 * 項目定義は「使わない」にしたものも含めて渡す（入力済みの値が消えて見えないようにするため）。
 */
export default async function SubstanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [m, actor, settings, item, defs] = await Promise.all([
    getServerMessages(),
    getActor(),
    getAppSettings(),
    prisma.substance.findFirst({ where: { id, deletedAt: null }, include: SUBSTANCE_INCLUDE }),
    prisma.substancePropertyDef.findMany({
      orderBy: [{ displayOrder: "asc" }, { key: "asc" }],
      include: { _count: { select: { values: true } } },
    }),
  ]);

  if (!item) notFound();
  const canEdit = actor?.has("SUBSTANCE_EDIT") ?? false;

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.substances.detailTitle}</h1>
      <SubstanceForm
        initial={toDetail(item)}
        defs={defs.map(toPropertyDefDto)}
        settings={settings}
        canEdit={canEdit}
      />
    </div>
  );
}
