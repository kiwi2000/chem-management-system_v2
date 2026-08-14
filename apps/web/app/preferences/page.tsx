import { PreferencesForm } from "@/components/preferences-form";
import { getSessionUser } from "@/lib/auth";
import { getLocale, getServerMessages } from "@/lib/i18n";
import { getBackground, getHeaderStrong, getTheme } from "@/lib/theme";

/**
 * 利用者ごとの設定。
 * 現在の値はサーバー側で解決して渡す（開いた直後に表示が入れ替わらないように）。
 */
export default async function PreferencesPage() {
  const [m, locale, theme, headerStrong, background, user] = await Promise.all([
    getServerMessages(),
    getLocale(),
    getTheme(),
    getHeaderStrong(),
    getBackground(),
    getSessionUser().catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.preferences.title}</h1>
      <p className="text-muted-foreground text-sm">{m.preferences.description}</p>
      <PreferencesForm
        locale={locale}
        theme={theme}
        headerStrong={headerStrong}
        background={background}
        displayName={user?.displayName ?? ""}
      />
    </div>
  );
}
