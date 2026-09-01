import { LawsScreen } from "@/components/laws-screen";
import { listLanguages } from "@/lib/language-service";
import { getAppSettings } from "@/lib/settings";

/**
 * 法規制のマスタ。
 * 「原文の言語」の選択肢はここで読んで画面へ渡す（件数が知れているので全部渡す）。
 *
 * **スコアの範囲もここで読む。**システム設定は管理者しか見られないので、
 * APIを緩めるのではなく、必要な2つの値だけをサーバー側から渡す（CLAUDE.md §4）。
 */
export default async function LawsPage() {
  const [languages, settings] = await Promise.all([listLanguages(), getAppSettings()]);
  return (
    <LawsScreen
      languages={languages}
      scoreRange={{ min: settings.categoryScoreMin, max: settings.categoryScoreMax }}
    />
  );
}
