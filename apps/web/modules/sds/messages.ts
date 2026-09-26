import type { Locale } from "@chem/shared";

/**
 * SDS モジュールの文言。
 *
 * **本体の辞書（packages/shared/src/i18n）には入れない。**SDS を外した配布物に SDS の言葉を残さないため。
 * 両言語をここで持ち、片方を忘れると型で落ちる
 */
interface SdsMessages {
  nav: string;
  title: string;
  preparing: string;
}

export const SDS_MESSAGES: Record<Locale, SdsMessages> = {
  ja: {
    nav: "SDS 作成",
    title: "SDS 作成",
    preparing: "SDS 作成の機能は準備中です。",
  },
  en: {
    nav: "SDS authoring",
    title: "SDS authoring",
    preparing: "SDS authoring is coming soon.",
  },
};

export const sdsMessages = (locale: Locale): SdsMessages => SDS_MESSAGES[locale];
