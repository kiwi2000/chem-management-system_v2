import { notFound } from "next/navigation";
import { DocumentView } from "@/components/doc-editor/document-view";
import { writeAudit } from "@/lib/audit";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { collectFor, containsComposition } from "@/lib/doc-data";
import { DOC_TEMPLATE_SELECT, toDocTemplateDto } from "@/lib/doc-template-service";
import { renderDocument } from "@/lib/doc-render";
import { getMessages, isLocale, organisationIdsIn } from "@chem/shared";
import { PrintOrientation } from "@/components/doc-editor/print-orientation";
import { TemplateFileDownload } from "@/components/doc-editor/template-file-download";

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
  searchParams,
}: {
  params: Promise<{ templateId: string; targetId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ templateId, targetId }, { from, to }] = await Promise.all([params, searchParams]);
  const actor = await getActor();
  if (!actor) notFound();

  const row = await prisma.documentTemplate.findFirst({
    where: { id: templateId, deletedAt: null, active: true },
    select: DOC_TEMPLATE_SELECT,
  });
  if (!row) notFound();
  const template = toDocTemplateDto(row);

  /*
    **紙面の言葉は、テンプレートに書いてある言語で決める。**
    読んでいる人の画面の言語ではない。英語の様式は、
    日本語で使っている人が出しても英語で出るのでなければ、
    相手に送るものとして使えない。
    画面の操作欄（印刷ボタンなど）は、読んでいる人の言語のまま。
  */
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

  /*
    預かった Excel・Word の様式は、**画面に出さずに落としてもらう。**
    紙面をこちらで組み立てないので、見せられるものが無い。
    値を埋めたファイルは、押されたときに作る（作った記録もそのときに残る）
  */
  if (template.kind !== "BLOCK") {
    return (
      <TemplateFileDownload
        href={`/api/document-files/${template.id}/${targetId}${search(from, to, template.usesRecipient)}`}
        title={`${template.code} ${template.nameJa}`}
        ready={template.fileName !== null}
        backHref={`/doc-templates/${template.id}`}
      />
    );
  }

  // 見る権限は、集める側が対象ごとに判断する（見られないものは null が返る）
  const data = await collectFor(actor, template.target, targetId, locale, m, parties);
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
        // 出した紙面をそのまま残す。あとで開いたときに当時の内容が出る
        content: doc as unknown as object,
        hasComposition: containsComposition(template.content, data.tables),
        params: {
          version: data.values.get("doc.version") ?? "",
          // 誰の名前で、誰に宛てて出したか。あとから記録だけで追えるように残す
          ...(parties.senderId ? { senderId: parties.senderId } : {}),
          ...(parties.recipientId ? { recipientId: parties.recipientId } : {}),
        },
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

/** 落とす先に付ける、差出人と宛先。印の無い様式に宛先は付けない */
function search(from: string | undefined, to: string | undefined, usesRecipient: boolean): string {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (usesRecipient && to) q.set("to", to);
  const s = q.toString();
  return s ? `?${s}` : "";
}
