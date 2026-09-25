"use client";

import { DEFAULT_LOCALE, getMessages, type Locale, type Messages } from "@chem/shared";
import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * クライアント側の文言。
 * ロケールはサーバーで確定させてから渡すので、読み込み後に言語が入れ替わるチラつきは起きない。
 * 辞書自体はソースに含まれるため、取得のための通信も発生しない。
 */
interface I18nValue {
  locale: Locale;
  m: Messages;
}

const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  m: getMessages(DEFAULT_LOCALE),
});

export function I18nProvider({
  locale,
  appName,
  children,
}: {
  locale: Locale;
  /**
   * システム設定で決めたシステムの名前（2026-09-25 指示）。
   * 題字・ログイン画面は `m.common.appName` を見ているので、ここで差し替えれば揃う
   */
  appName?: string;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    const base = getMessages(locale);
    const m =
      appName && appName !== base.common.appName
        ? { ...base, common: { ...base.common, appName } }
        : base;
    return { locale, m };
  }, [locale, appName]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** 例: `const { m } = useI18n();` → `m.login.submit` */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
