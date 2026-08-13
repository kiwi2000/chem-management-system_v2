import { HomeNews } from "@/components/home-news";
import { getServerMessages } from "@/lib/i18n";

/**
 * ホーム。
 * 本文には掲載中のお知らせを出す。ダッシュボード的な内容は機能が揃ってから足す。
 */
export default async function HomePage() {
  const m = await getServerMessages();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{m.home.title}</h1>
      <HomeNews />
    </div>
  );
}
