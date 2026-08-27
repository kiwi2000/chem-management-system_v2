import { notFound } from "next/navigation";
import { DocumentView } from "@/components/doc-editor/document-view";
import { writeAudit } from "@/lib/audit";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { collectFor } from "@/lib/doc-data";
import { DOC_TEMPLATE_SELECT, toDocTemplateDto } from "@/lib/doc-template-service";
import { renderDocument } from "@/lib/doc-render";
import { getLocale, getServerMessages } from "@/lib/i18n";
import { PrintOrientation } from "@/components/doc-editor/print-orientation";

/**
 * できあがった帳票。テンプレート × 対象1件で1枚。
 *
 * **ここで作ったファイルは残さない。**開くたびに作り直すので、
 * あとで権限が変わった人が古いものを取れる、という穴ができない。
 * 記録には「誰がいつ何に対して作ったか」だけを残す。
 */
/**
 * 保存するときのファイル名になる題名。
 *
 * **画面側で `document.title` を書き換えても効かない。**
 * Next.js がメタデータで上書きするため、ここで決める。
 * テンプレート・対象・日付の3つが揃っていれば、あとから何の帳票か分かる。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ templateId: string; targetId: string }>;
}) {
  const { templateId, targetId } = await params;
  const [template, product, substance] = await Promise.all([
    prisma.documentTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: { code: true },
    }),
    prisma.product.findFirst({ where: { id: targetId }, select: { code: true } }),
    prisma.substance.findFirst({ where: { id: targetId }, select: { code: true } }),
  ]);
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const target = product?.code ?? substance?.code ?? "";
  return { title: [template?.code, target, day].filter(Boolean).join("_") };
}

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ templateId: string; targetId: string }>;
}) {
  const { templateId, targetId } = await params;
  const actor = await getActor();
  if (!actor) notFound();

  const [m, locale] = await Promise.all([getServerMessages(), getLocale()]);
  const row = await prisma.documentTemplate.findFirst({
    where: { id: templateId, deletedAt: null, active: true },
    select: DOC_TEMPLATE_SELECT,
  });
  if (!row) notFound();
  const template = toDocTemplateDto(row);

  // 見る権限は、集める側が対象ごとに判断する（見られないものは null が返る）
  const data = await collectFor(actor, template.target, targetId, locale, m);
  if (!data) notFound();

  const doc = renderDocument({
    content: template.content,
    target: template.target,
    values: data.values,
    tables: data.tables,
  });

  await Promise.all([
    prisma.generatedDocument.create({
      data: {
        templateId: template.id,
        targetRef: targetId,
        targetCode: data.code,
        generatedBy: actor.user.id,
        params: { version: data.values.get("doc.version") ?? "" },
      },
    }),
    // 持ち出しの記録。組成が載ることがあるので、閲覧としても残す
    writeAudit({
      entity: "generated_documents",
      entityId: template.id,
      action: "export",
      actorId: actor.user.id,
      diff: { template: template.code, target: data.code },
    }),
  ]);

  return (
    <>
      <PrintOrientation orientation={doc.orientation} />
      <DocumentView
        doc={doc}
        title={`${template.code} ${template.nameJa}`}
        backHref={`/doc-templates/${template.id}`}
        /*
          保存するときのファイル名。**中身が分かる名前にする。**
          テンプレート・対象・日付の3つが揃っていれば、
          あとから見て何の帳票か分かる（記号は入れない。ファイル名に使えない環境がある）
        */
      />
    </>
  );
}
