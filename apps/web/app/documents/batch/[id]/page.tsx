import { notFound } from "next/navigation";
import { DocumentBatchView } from "@/components/doc-editor/document-batch-view";
import { PrintOrientation } from "@/components/doc-editor/print-orientation";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
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
  const day = job.createdAt.toISOString().slice(0, 10).replace(/-/g, "");
  return { title: [job.template.code, "batch", day].join("_") };
}

export default async function DocumentBatchResultPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor || !actor.has("DOCUMENT_CREATE")) notFound();

  const job = await prisma.documentBatchJob.findFirst({
    // 他人のものは、あることも伝えない
    where: { id, createdBy: actor.user.id },
    select: {
      missed: true,
      template: { select: { code: true, nameJa: true, content: true } },
      documents: {
        // 組成が載っているものは、権限のある人にだけ
        where: actor.has("COMPOSITION_VIEW") ? {} : { hasComposition: false },
        orderBy: { generatedAt: "asc" },
        select: { targetCode: true, content: true },
      },
    },
  });
  if (!job) notFound();

  const orientation =
    (job.template.content as { orientation?: "portrait" | "landscape" } | null)?.orientation ??
    "portrait";

  return (
    <>
      <PrintOrientation orientation={orientation} />
      <DocumentBatchView
        docs={job.documents.map((d) => ({
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
