import { HEADER_STRONG_CLASS, getMessages, themeClass } from "@chem/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getLocale } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n-client";
import { getHeaderStrong, getTheme } from "@/lib/theme";
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
  const [locale, theme, headerStrong] = await Promise.all([
    getLocale(),
    getTheme(),
    getHeaderStrong(),
  ]);

  return (
    <html lang={locale} className={cn(themeClass(theme), headerStrong && HEADER_STRONG_CLASS)}>
      <head>
        {theme === "system" && <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />}
      </head>
      <body className="bg-background min-h-screen antialiased">
        <I18nProvider locale={locale}>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
