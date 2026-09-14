import { ExportForm } from "@/components/export-form";
import { ForbiddenNotice } from "@/components/forbidden-notice";
import { getActor } from "@/lib/authz";
import { prisma } from "@/lib/db";

/**
 * エクスポート。選択肢（法律・データソース）はここで読んで渡す。
 * 法律の一覧 API は REGULATION_VIEW が要り、持ち出しの権限だけの人が叩けないため
 */
export default async function ExportPage() {
  const actor = await getActor();
  if (!actor?.has("DATA_EXPORT")) return <ForbiddenNotice />;
  const [laws, sources] = await Promise.all([
    prisma.law.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
      select: { code: true, nameJa: true, nameOriginal: true },
    }),
    prisma.source.findMany({
      where: { deletedAt: null },
      orderBy: { code: "asc" },
      select: { code: true },
    }),
  ]);
  return (
    <ExportForm
      laws={laws.map((l) => ({ code: l.code, label: l.nameJa ?? l.nameOriginal }))}
      sources={sources.map((s) => ({ code: s.code, label: s.code }))}
    />
  );
}
