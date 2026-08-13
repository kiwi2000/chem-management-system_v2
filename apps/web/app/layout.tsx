import { getMessages } from "@chem/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getLocale } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n-client";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const m = getMessages(await getLocale());
  return { title: m.common.appName };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body className="bg-muted/20 min-h-screen antialiased">
        <I18nProvider locale={locale}>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
