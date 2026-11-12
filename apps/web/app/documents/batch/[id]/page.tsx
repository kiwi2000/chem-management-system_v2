import { notFound } from "next/navigation";
import { DocumentBatchView } from "@/components/doc-editor/document-batch-view";
import { PrintOrientation } from "@/components/doc-editor/print-orientation";
import { getActor } from "@/lib/authz";
import { DOC_ACCESS_SELECT, openableDocuments } from "@/lib/doc-access";
import { prisma } from "@/lib/db";
import { dayInJapan } from "@/lib/judgement-date";
import type { RenderedDocument } from "@/lib/doc-render";

/**
 * まとめて作った帳票を、仕事ごとに続けて出す（バックグラウンド処理の結果。2026-09-16）。
 *
 * **作り直さない。**仕事が残した紙面をそのまま並べ、帳票のあいだに改ページを挟んで
 * **1 回の印刷で全部が出る**ようにする。PDF として保存すれば 1 つのファイルにまとまる。
 *
 * **開けるのは自分が頼んだ仕事だけ。**組成が載っている帳票は、いま組成を見る権限が
 * ある人にだけ出す（保存した帳票を 1 件ずつ開くときと同じ）。
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await prisma.documentBatchJob.findUnique({
    where: { id },
    select: { createdAt: true, template: { select: { code: true } } },
  });
  if (!job) return {};
  const day = dayInJapan(job.createdAt).replace(/-/g, "");
  return { title: [job.template.code, "batch", day].join("_") };
}

export default async function DocumentBatchResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  // 自分が頼んだ仕事だけを開く。作れる人なら、自分のぶんは開ける（2026-09-17 指示）
  if (!actor || !actor.has("DOCUMENT_CREATE")) notFound();

  const job = await prisma.documentBatchJob.findFirst({
    // 他人のものは、あることも伝えない
    where: { id, createdBy: actor.user.id },
    select: {
      missed: true,
      template: { select: { code: true, nameJa: true, content: true } },
      documents: {
        orderBy: { generatedAt: "asc" },
        select: { ...DOC_ACCESS_SELECT, id: true, targetCode: true, content: true },
      },
    },
  });
  if (!job) notFound();
  // 見られない情報を含む帳票は出さない（S31。作った本人でも）
  const openable = await openableDocuments(actor, job.documents);
  const documents = job.documents.filter((d) => openable.has(d.id));

  const orientation =
    (job.template.content as { orientation?: "portrait" | "landscape" } | null)?.orientation ??
    "portrait";

  return (
    <>
      <PrintOrientation orientation={orientation} />
      <DocumentBatchView
        docs={documents.map((d) => ({
          code: d.targetCode,
          doc: d.content as unknown as RenderedDocument,
        }))}
        title={`${job.template.code} ${job.template.nameJa}`}
        backHref="/documents"
        missed={job.missed}
      />
    </>
  );
}
