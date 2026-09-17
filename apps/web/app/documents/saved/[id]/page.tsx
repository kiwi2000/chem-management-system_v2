import { notFound } from "next/navigation";
import { DocumentView } from "@/components/doc-editor/document-view";
import { SavedFileNote } from "@/components/doc-editor/saved-file-note";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { canAccessDocument, canOpenDocument } from "@/lib/doc-access";
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
      targetRef: true,
      generatedBy: true,
      template: { select: { code: true, nameJa: true, target: true } },
    },
  });
  if (!row) notFound();
  // 自分のものか、権限があれば他人のものも（lib/doc-access.ts）。見せないものは、あることも伝えない
  if (!(await canAccessDocument(actor, row))) notFound();
  /*
    紙面を開くのは、落とすのと同じ扱い（印刷して保存できる。2026-09-17 指示）。
    **自分が作ったものは、作れる人なら開ける。**他人のぶんには権限が要る（同日 指示）
  */
  if (!canOpenDocument(actor, row)) return <ForbiddenNotice />;

  /*
    **ファイルの様式で作ったものは、紙面が残っていない。**
    残せるのはファイルそのものになるが、それは持ち出しになるので置いていない。
    何を出したかだけを伝える
  */
  const saved = row.content as { file?: { name: string } } | null;
  if (saved && typeof saved === "object" && saved.file) {
    return (
      <SavedFileNote title={`${row.template.code} ${row.targetCode}`} name={saved.file.name} />
    );
  }

  return (
    <DocumentView
      doc={row.content as unknown as RenderedDocument}
      title={`${row.template.code} ${row.targetCode}`}
      backHref="/documents"
    />
  );
}
