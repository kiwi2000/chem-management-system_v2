import { LawsScreen } from "@/components/laws-screen";
import { listLanguages } from "@/lib/language-service";

/**
 * 法規制のマスタ。
 * 「原文の言語」の選択肢はここで読んで画面へ渡す（件数が知れているので全部渡す）。
 */
export default async function LawsPage() {
  const languages = await listLanguages();
  return <LawsScreen languages={languages} />;
}
