import { DocumentsScreen } from "@/components/documents-screen";
import { getCurrentVersion } from "@/lib/current-version";
import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n";
import { listJudgementCategoryOptions } from "@/lib/judgement-category-options";
import { getAppSettings } from "@/lib/settings";

/**
 * ドキュメント生成。様式を選んで作り、自分が作ったものを見る。
 * 様式そのものを直すのは「テンプレート編集」の画面。
 *
 * 作る相手を選ぶ表は製品・物質の一覧と同じ列・同じ絞り込みなので（2026-09-16 指示）、
 * 一覧の画面と同じ選択肢（型式・用途・該当法規制・ランク）をここで読んで渡す
 */
export default async function DocumentsPage() {
  const [settings, locale, version, bands] = await Promise.all([
    getAppSettings(),
    getLocale(),
    getCurrentVersion(),
    prisma.substanceRankBand.findMany({
      where: { deletedAt: null },
      orderBy: { displayOrder: "asc" },
      select: { label: true },
    }),
  ]);
  const judgementCategories = await listJudgementCategoryOptions(locale, version?.id ?? null);
  return (
    <DocumentsScreen
      product={{
        modelOptions: settings.productModelOptions,
        useOptions: settings.productUseOptions,
        judgementCategories,
      }}
      substance={{ rankOptions: [...new Set(bands.map((b) => b.label))] }}
    />
  );
}
