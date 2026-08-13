"use client";

import { DEFAULT_LOCALE, getMessages, type Locale, type Messages } from "@chem/shared";
import { createContext, useContext, type ReactNode } from "react";

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

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <I18nContext.Provider value={{ locale, m: getMessages(locale) }}>
      {children}
    </I18nContext.Provider>
  );
}

/** 例: `const { m } = useI18n();` → `m.login.submit` */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
