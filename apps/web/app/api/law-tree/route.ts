import { requirePermission } from "@/lib/authz";
import { getServerMessages } from "@/lib/i18n";
import { lawTreeDelete } from "@/lib/law-delete";
import { runStampedDelete } from "@/lib/stamped-delete";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/law-tree — 法令の木で選んだ法律・区分・分類を、種類をまたいでまとめて論理削除する
 * （本文 `{ items: [{ id: "law:…" | "category:…" | "class:…", stamp }], force? }`。lib/stamped-delete.ts）。
 * 全部か、何もしないか。子から先に消し、いっしょに消す子は「残っている」に数えない
 */
export async function DELETE(req: Request) {
  const actor = await requirePermission("REGULATION_EDIT");
  if (actor instanceof Response) return actor;
  const m = await getServerMessages();
  return runStampedDelete(req, m, lawTreeDelete(actor, m));
}
