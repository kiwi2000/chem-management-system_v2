import { notFound } from "next/navigation";
import { DocumentSheet } from "@/components/doc-editor/document-view";
import { PrintOrientation } from "@/components/doc-editor/print-orientation";
import { prisma } from "@/lib/db";
import type { RenderedDocument } from "@/lib/doc-render";
import { verifyPrintToken } from "@/lib/print-token";

/**
 * 帳票 1 枚の紙面だけを出す（PDF 化用）。
 *
 * **ログインではなく、短命の印（print-token.ts）で開く。**PDF を作るサーバー側のブラウザが、
 * 自分自身（127.0.0.1）からこのページを開いて PDF にする。印はその帳票にしか効かず 2 分で切れる。
 * 印が無い・違うときは、あることも伝えない
 */
export const dynamic = "force-dynamic";

export default async function PrintDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ id }, { t }] = await Promise.all([params, searchParams]);
  if (!verifyPrintToken(id, t)) notFound();

  const row = await prisma.generatedDocument.findUnique({
    where: { id },
    select: { content: true },
  });
  if (!row) notFound();
  const doc = row.content as unknown as RenderedDocument;

  return (
    <>
      <PrintOrientation orientation={doc.orientation} />
      <DocumentSheet doc={doc} />
    </>
  );
}
