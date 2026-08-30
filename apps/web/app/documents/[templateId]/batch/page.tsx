import { getMessages, isLocale, organisationIdsIn } from "@chem/shared";
import { notFound } from "next/navigation";
import { DocumentBatchView } from "@/components/doc-editor/document-batch-view";
import { PrintOrientation } from "@/components/doc-editor/print-orientation";
import { writeAudit } from "@/lib/audit";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { BATCH_MAX, parseBatchIds } from "@/lib/doc-batch";
import { collectFor, containsComposition } from "@/lib/doc-data";
import { renderDocument, type RenderedDocument } from "@/lib/doc-render";
import { DOC_TEMPLATE_SELECT, toDocTemplateDto } from "@/lib/doc-template-service";

/**
 * まとめて帳票を作る。
 *
 * **1枚の画面に続けて出す。**1件ずつ開いて印刷を繰り返すのは手間なので、
 * 帳票のあいだに改ページを挟み、**1回の印刷で全部が出る**ようにする。
 * PDF として保存すれば、そのまま1つのファイルにまとまる。
 *
 * **1件でも作れなかったら、そこで止めない。**見る権限が無いものが
 * 混ざっていることがあるので、作れたものを出し、
 * 作れなかったものは画面の側で断る（紙には出さない）。
 */
export async function generateMetadata({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const template = await prisma.documentTemplate.findFirst({
    where: { id: templateId, deletedAt: null },
    select: { code: true },
  });
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return { title: [template?.code, "batch", day].filter(Boolean).join("_") };
}

export default async function DocumentBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ ids?: string; from?: string; to?: string }>;
}) {
  const [{ templateId }, { ids: raw, from, to }] = await Promise.all([params, searchParams]);
  const actor = await getActor();
  if (!actor) notFound();

  const row = await prisma.documentTemplate.findFirst({
    where: { id: templateId, deletedAt: null, active: true },
    select: DOC_TEMPLATE_SELECT,
  });
  if (!row) notFound();
  const template = toDocTemplateDto(row);

  const lower = template.locale.toLowerCase();
  const locale = isLocale(lower) ? lower : "ja";
  const m = getMessages(locale);

  /*
    差出人と宛先。**宛先は「宛先を使う」印の付いた様式でだけ見る。**
    印の無い様式に付いてきても捨てる（URLに書けば効く、という状態を作らない）。
    差出人を差し替えられるかどうかは、集める側が権限で判断する
  */
  const parties = {
    senderId: from ?? null,
    recipientId: template.usesRecipient ? (to ?? null) : null,
    // 様式が名指ししている組織（組織ブロック）
    organisationIds: organisationIdsIn(template.content),
  };

  const ids = parseBatchIds(raw);
  const asked = (raw ?? "").split(",").filter(Boolean).length;

  const made: {
    id: string;
    code: string;
    version: string;
    hasComposition: boolean;
    doc: RenderedDocument;
  }[] = [];
  const missed: string[] = [];
  for (const id of ids) {
    const data = await collectFor(actor, template.target, id, locale, m, parties);
    if (!data) {
      missed.push(id);
      continue;
    }
    made.push({
      id,
      code: data.code,
      version: data.values.get("doc.version") ?? "",
      hasComposition: containsComposition(template.content, data.tables),
      doc: renderDocument({
        content: template.content,
        target: template.target,
        values: data.values,
        tables: data.tables,
      }),
    });
  }

  if (made.length > 0) {
    await Promise.all([
      prisma.generatedDocument.createMany({
        data: made.map((x) => ({
          templateId: template.id,
          targetRef: x.id,
          targetCode: x.code,
          generatedBy: actor.user.id,
          content: x.doc as unknown as object,
          hasComposition: x.hasComposition,
          params: { version: x.version },
        })),
      }),
      writeAudit({
        entity: "generated_documents",
        entityId: template.id,
        action: "export",
        actorId: actor.user.id,
        diff: { template: template.code, count: made.length },
      }),
    ]);
  }

  return (
    <>
      <PrintOrientation orientation={template.content.orientation} />
      <DocumentBatchView
        docs={made}
        title={`${template.code} ${template.nameJa}`}
        backHref="/doc-templates"
        missed={missed.length}
        tooMany={asked > BATCH_MAX ? BATCH_MAX : 0}
      />
    </>
  );
}
