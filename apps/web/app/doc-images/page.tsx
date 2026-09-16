import { ForbiddenNotice } from "@/components/forbidden-notice";
import { ImageLibraryScreen } from "@/components/image-library-screen";
import { getActor } from "@/lib/authz";

/**
 * 画像ライブラリ（2026-09-16 指示）。テンプレートの「画像」ブロックで使う画像の置き場所。
 * 見るのは帳票を作れる人かテンプレートを直せる人。入れる・直す・消すはテンプレートを直せる人
 */
export default async function ImageLibraryPage() {
  const actor = await getActor();
  if (!actor?.has("DOC_TEMPLATE_EDIT") && !actor?.has("DOCUMENT_CREATE")) {
    return <ForbiddenNotice />;
  }
  return <ImageLibraryScreen />;
}
