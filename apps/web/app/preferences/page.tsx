import { PreferencesForm } from "@/components/preferences-form";
import { getLocale, getServerMessages } from "@/lib/i18n";
import { getTheme } from "@/lib/theme";

/**
 * 利用者ごとの設定。
 * 現在の値はサーバー側で解決して渡す（開いた直後に表示が入れ替わらないように）。
 */
export default async function PreferencesPage() {
  const [m, locale, theme] = await Promise.all([getServerMessages(), getLocale(), getTheme()]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.preferences.title}</h1>
      <p className="text-muted-foreground text-sm">{m.preferences.description}</p>
      <PreferencesForm locale={locale} theme={theme} />
    </div>
  );
}
