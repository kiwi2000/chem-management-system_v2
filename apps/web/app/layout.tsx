import { HEADER_STRONG_CLASS, backgroundClass, getMessages, themeClass } from "@chem/shared";
import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { IdleGuard } from "@/components/idle-logout";
import { getSessionUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n-client";
import { getAppSettings } from "@/lib/settings";
import { NONCE_HEADER } from "@/lib/routes";
import { getBackground, getHeaderStrong, getTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const m = getMessages(await getLocale());
  return { title: m.common.appName };
}

/**
 * 「端末の設定に合わせる」を選んでいるときだけ、OSが暗い配色なら .dark を付ける。
 * 描画前に実行して、白い画面が一瞬見えるのを防ぐ。
 */
const SYSTEM_THEME_SCRIPT = `try{if(matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  // middleware が要求ごとに作る使い捨ての印。これが付いた script だけが実行できる
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  const [locale, theme, headerStrong, background, user, settings] = await Promise.all([
    getLocale(),
    getTheme(),
    getHeaderStrong(),
    getBackground(),
    getSessionUser().catch(() => null),
    getAppSettings(),
  ]);

  return (
    <html
      lang={locale}
      /*
        「システムに合わせる」ときは、下の script が React より先に
        <html> へ dark を付ける。画面が一瞬白く光るのを防ぐためで、意図した動き。
        サーバー側は利用者の端末の設定を知りようがないので、ここは必ず食い違う。
        React に「ここの食い違いは想定内」と伝えて、警告を出させない。
      */
      suppressHydrationWarning
      className={cn(
        themeClass(theme),
        headerStrong && HEADER_STRONG_CLASS,
        backgroundClass(background),
      )}
    >
      <head>
        {theme === "system" && (
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
        )}
      </head>
      <body className="bg-background min-h-screen antialiased">
        <I18nProvider locale={locale}>
          {/* ログインしている画面だけ。ログイン画面で時計を回しても意味が無い */}
          <IdleGuard idleMinutes={settings.sessionIdleMinutes} enabled={user !== null}>
            <AppShell>{children}</AppShell>
          </IdleGuard>
        </I18nProvider>
      </body>
    </html>
  );
}
