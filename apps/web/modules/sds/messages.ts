import type { Locale } from "@chem/shared";

/**
 * SDS モジュールの文言。
 *
 * **本体の辞書（packages/shared/src/i18n）には入れない。**SDS を外した配布物に SDS の言葉を残さないため。
 * 両言語をここで持ち、片方を忘れると型で落ちる。
 * GHS 分類データ（一覧・取り込み・物質の詳細の欄）は 2026-10-16 に標準へ移したので、その文言は本体の辞書の `ghsData` にある
 */
interface SdsMessages {
  nav: string;
  title: string;
  preparing: string;
  /** 入口から、標準の GHS分類データへ */
  linkGhsData: string;
}

export const SDS_MESSAGES: Record<Locale, SdsMessages> = {
  ja: {
    nav: "SDS 作成",
    title: "SDS 作成",
    preparing:
      "SDS を作る機能は準備中です。物質の GHS 分類は、法規制の「GHS分類データ」で見られます。",
    linkGhsData: "GHS分類データ",
  },
  en: {
    nav: "SDS authoring",
    title: "SDS authoring",
    preparing:
      "SDS authoring is in preparation. Substance GHS classifications are under Regulations › GHS classification data.",
    linkGhsData: "GHS classification data",
  },
};

export const sdsMessages = (locale: Locale): SdsMessages => SDS_MESSAGES[locale];
