import { DocTemplateEditor } from "@/components/doc-editor/doc-template-editor";

/**
 * テンプレートの中身を編集する画面。
 * 入れもの（名前・対象）は一覧の側で直す
 */
export default async function DocTemplateEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocTemplateEditor id={id} />;
}
