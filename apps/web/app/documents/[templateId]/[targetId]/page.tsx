import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { DOC_TEMPLATE_SELECT, toDocTemplateDto } from "@/lib/doc-template-service";
import { TemplateFileDownload } from "@/components/doc-editor/template-file-download";
import { ForbiddenNotice } from "@/components/forbidden-notice";

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
  const [template, product, substance, organisation, category] = await Promise.all([
    prisma.documentTemplate.findFirst({
      where: { id: templateId, deletedAt: null },
      select: { code: true },
    }),
    prisma.product.findFirst({ where: { id: targetId }, select: { code: true } }),
    prisma.substance.findFirst({ where: { id: targetId }, select: { code: true } }),
    prisma.organisation.findFirst({ where: { id: targetId }, select: { code: true } }),
    prisma.regulationCategory.findFirst({ where: { id: targetId }, select: { code: true } }),
  ]);
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const target = product?.code ?? substance?.code ?? organisation?.code ?? category?.code ?? "";
  return { title: [template?.code, target, day].filter(Boolean).join("_") };
}

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string; targetId: string }>;
  searchParams: Promise<{ company?: string; department?: string; to?: string }>;
}) {
  const [{ templateId, targetId }, { company, department, to }] = await Promise.all([
    params,
    searchParams,
  ]);
  // 帳票を作れる人だけ（保存した帳票の画面と同じ）。権限が無ければ、あることも伝えない
  const actor = await getActor();
  if (!actor || !actor.has("DOCUMENT_CREATE")) notFound();
  // 値を埋めたファイルを落とす画面なので、落とす権限が要る（2026-09-17）
  if (!actor.has("DOCUMENT_DOWNLOAD")) return <ForbiddenNotice />;

  const row = await prisma.documentTemplate.findFirst({
    where: { id: templateId, deletedAt: null, active: true },
    select: DOC_TEMPLATE_SELECT,
  });
  if (!row) notFound();
  const template = toDocTemplateDto(row);

  /*
    画面編集の様式は、1 件でもバックグラウンド処理で PDF にする（2026-09-16 指示）。
    この画面は **預かった Excel・Word の様式** のためにだけ残す。
    紙面をこちらで組み立てないので、画面に出さずに落としてもらう。
    値を埋めたファイルは、押されたときに作る（作った記録もそのときに残る）
  */
  if (template.kind === "BLOCK") redirect("/documents");

  return (
    <TemplateFileDownload
      href={`/api/document-files/${template.id}/${targetId}${search(company, department, to, template.usesRecipient)}`}
      title={`${template.code} ${template.nameJa}`}
      ready={template.fileName !== null}
      backHref="/documents"
    />
  );
}

/** 落とす先に付ける、差出人と宛先。印の無い様式に宛先は付けない */
function search(
  company: string | undefined,
  department: string | undefined,
  to: string | undefined,
  usesRecipient: boolean,
): string {
  const q = new URLSearchParams();
  if (company) q.set("company", company);
  if (department) q.set("department", department);
  if (usesRecipient && to) q.set("to", to);
  const s = q.toString();
  return s ? `?${s}` : "";
}
