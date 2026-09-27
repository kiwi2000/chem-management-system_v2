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
  /** GHS 分類データの取り込み（S23 段 0） */
  ghs: {
    title: string;
    lead: string;
    linkFromHome: string;
    releases: string;
    noReleases: string;
    columns: {
      source: string;
      label: string;
      publishedOn: string;
      importedAt: string;
      added: string;
      changed: string;
      unchanged: string;
      closed: string;
      issues: string;
    };
    import: {
      title: string;
      hint: string;
      source: string;
      label: string;
      publishedOn: string;
      mainFile: string;
      rationaleFile: string;
      optional: string;
      preview: string;
      apply: string;
      previewing: string;
      applying: string;
      previewResult: (
        parsed: number,
        added: number,
        changed: number,
        unchanged: number,
        disappeared: number,
        issues: number,
      ) => string;
      applied: (label: string) => string;
      needFile: string;
      needLabel: string;
      needDate: string;
      tooLarge: (maxMb: number) => string;
      unreadable: string;
      wrongColumns: (missing: string[]) => string;
      sampleTitle: string;
      issuesTitle: string;
      adminOnly: string;
    };
    /** 物質の詳細の欄 */
    section: {
      title: string;
      asOf: (day: string) => string;
      columns: {
        source: string;
        hazardClass: string;
        category: string;
        status: string;
        hCodes: string;
        targetOrgans: string;
        revision: string;
        classifiedIn: string;
      };
      showAll: string;
      showClassifiedOnly: string;
      none: string;
    };
    status: Record<
      "CLASSIFIED" | "NOT_CLASSIFIED" | "CANNOT_CLASSIFY" | "NOT_APPLICABLE" | "NOT_EVALUATED",
      string
    >;
  };
}

export const SDS_MESSAGES: Record<Locale, SdsMessages> = {
  ja: {
    nav: "SDS 作成",
    title: "SDS 作成",
    preparing: "SDS を作る機能は準備中です。まず、物質の GHS 分類の土台から作っています。",
    ghs: {
      title: "GHS 分類データ",
      lead: "国の機関が公表している物質ごとの GHS 分類を取り込みます。取り込んだ分類は、物質の詳細に出どころ別に出ます。",
      linkFromHome: "GHS 分類データの取り込み",
      releases: "取り込みの記録",
      noReleases: "まだ取り込んでいません。",
      columns: {
        source: "出どころ",
        label: "公表",
        publishedOn: "公表日",
        importedAt: "取り込み日時",
        added: "追加",
        changed: "変更",
        unchanged: "変わらず",
        closed: "終了",
        issues: "要確認",
      },
      import: {
        title: "取り込み",
        hint: "NITE の「NITE統合版 GHS分類結果」の Excel（区分一覧）を選びます。根拠一覧の Excel も選ぶと、分類年度と GHS 改訂版が入ります。先に「下見」で追加・変更の件数を確かめてから「取り込む」を押してください。",
        source: "出どころ",
        label: "公表の名前",
        publishedOn: "公表日",
        mainFile: "区分一覧（Excel）",
        rationaleFile: "根拠一覧（Excel）",
        optional: "任意",
        preview: "下見",
        apply: "取り込む",
        previewing: "読んでいます…",
        applying: "取り込んでいます…",
        previewResult: (parsed, added, changed, unchanged, disappeared, issues) =>
          `読み取り ${parsed} 件: 追加 ${added}・変更 ${changed}・変わらず ${unchanged}・見当たらず ${disappeared}・要確認 ${issues}`,
        applied: (label) => `「${label}」を取り込みました。`,
        needFile: "区分一覧の Excel を選んでください",
        needLabel: "公表の名前を入れてください",
        needDate: "公表日を入れてください",
        tooLarge: (maxMb) => `ファイルは 1 つ ${maxMb} MB までです`,
        unreadable: "Excel として読めませんでした",
        wrongColumns: (missing) => `区分一覧の見出しに次の列がありません: ${missing.join("・")}`,
        sampleTitle: "変更の例（先頭 20 件）",
        issuesTitle: "要確認（先頭 20 件）",
        adminOnly: "取り込みはシステム管理者だけができます。",
      },
      section: {
        title: "GHS 分類（出どころ別）",
        asOf: (day) => `判定対象日 ${day}`,
        columns: {
          source: "出どころ",
          hazardClass: "危険有害性クラス",
          category: "区分",
          status: "状態",
          hCodes: "H コード",
          targetOrgans: "標的臓器",
          revision: "GHS 改訂",
          classifiedIn: "分類年度",
        },
        showAll: "該当しない項目も表示",
        showClassifiedOnly: "該当する項目だけ表示",
        none: "この CAS の分類は取り込まれていません。",
      },
      status: {
        CLASSIFIED: "該当",
        NOT_CLASSIFIED: "区分に該当しない",
        CANNOT_CLASSIFY: "分類できない",
        NOT_APPLICABLE: "分類対象外",
        NOT_EVALUATED: "未評価",
      },
    },
  },
  en: {
    nav: "SDS authoring",
    title: "SDS authoring",
    preparing:
      "SDS authoring is in preparation. The first piece being built is the substance GHS classification data.",
    ghs: {
      title: "GHS classification data",
      lead: "Import the substance-level GHS classifications published by national authorities. Imported classifications appear on each substance's detail page, by source.",
      linkFromHome: "Import GHS classification data",
      releases: "Import history",
      noReleases: "Nothing has been imported yet.",
      columns: {
        source: "Source",
        label: "Release",
        publishedOn: "Published",
        importedAt: "Imported",
        added: "Added",
        changed: "Changed",
        unchanged: "Unchanged",
        closed: "Closed",
        issues: "To review",
      },
      import: {
        title: "Import",
        hint: "Choose the NITE consolidated classification Excel (category list). Adding the rationale Excel fills in the classification year and GHS revision. Run “Preview” first to see the counts, then “Import”.",
        source: "Source",
        label: "Release name",
        publishedOn: "Published on",
        mainFile: "Category list (Excel)",
        rationaleFile: "Rationale list (Excel)",
        optional: "optional",
        preview: "Preview",
        apply: "Import",
        previewing: "Reading…",
        applying: "Importing…",
        previewResult: (parsed, added, changed, unchanged, disappeared, issues) =>
          `Read ${parsed}: ${added} added, ${changed} changed, ${unchanged} unchanged, ${disappeared} missing, ${issues} to review`,
        applied: (label) => `Imported “${label}”.`,
        needFile: "Choose the category list Excel",
        needLabel: "Enter the release name",
        needDate: "Enter the published date",
        tooLarge: (maxMb) => `Each file must be ${maxMb} MB or smaller`,
        unreadable: "Could not read the file as Excel",
        wrongColumns: (missing) =>
          `The category list is missing these columns: ${missing.join(", ")}`,
        sampleTitle: "Examples of changes (first 20)",
        issuesTitle: "To review (first 20)",
        adminOnly: "Only system administrators can import.",
      },
      section: {
        title: "GHS classification (by source)",
        asOf: (day) => `As of ${day}`,
        columns: {
          source: "Source",
          hazardClass: "Hazard class",
          category: "Category",
          status: "Status",
          hCodes: "H codes",
          targetOrgans: "Target organs",
          revision: "GHS rev.",
          classifiedIn: "Classified in",
        },
        showAll: "Show non-classified items too",
        showClassifiedOnly: "Show classified items only",
        none: "No classification has been imported for this CAS.",
      },
      status: {
        CLASSIFIED: "Classified",
        NOT_CLASSIFIED: "Not classified",
        CANNOT_CLASSIFY: "Classification not possible",
        NOT_APPLICABLE: "Not applicable",
        NOT_EVALUATED: "Not evaluated",
      },
    },
  },
};

export const sdsMessages = (locale: Locale): SdsMessages => SDS_MESSAGES[locale];
