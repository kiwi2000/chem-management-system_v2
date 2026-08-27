import { notFound } from "next/navigation";
import { DocumentView } from "@/components/doc-editor/document-view";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { RenderedDocument } from "@/lib/doc-render";

/**
 * 発行済みのドキュメントを開く。
 *
 * **作り直さない。**出したときの紙面をそのまま出す。
 * 組成や判定が変わっていても、発行した内容は変わらない。
 *
 * **開けるのは自分が作ったものだけ。**他人のものは見られない。
 * 組成が載っているものは、**いま組成を見る権限があるか**も確かめる
 * （作った当時は見られた人でも、外されていることがある）。
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await prisma.generatedDocument.findUnique({
    where: { id },
    select: { targetCode: true, generatedAt: true, template: { select: { code: true } } },
  });
  if (!row) return {};
  const day = row.generatedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return { title: [row.template.code, row.targetCode, day].join("_") };
}

export default async function SavedDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor || !actor.has("DOCUMENT_CREATE")) notFound();

  const row = await prisma.generatedDocument.findUnique({
    where: { id },
    select: {
      content: true,
      hasComposition: true,
      targetCode: true,
      generatedBy: true,
      template: { select: { code: true, nameJa: true } },
    },
  });
  if (!row) notFound();
  // 他人のものは、あることも伝えない
  if (row.generatedBy !== actor.user.id) notFound();
  if (row.hasComposition && !actor.has("COMPOSITION_VIEW")) notFound();

  return (
    <DocumentView
      doc={row.content as unknown as RenderedDocument}
      title={`${row.template.code} ${row.targetCode}`}
      backHref="/documents"
    />
  );
}
