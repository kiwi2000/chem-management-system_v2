import type { Locale } from "@chem/shared";

/**
 * SDS モジュールの文言。
 *
 * **本体の辞書（packages/shared/src/i18n）には入れない。**SDS を外した配布物に SDS の言葉を残さないため。
 * 両言語をここで持ち、片方を忘れると型で落ちる
 */
interface SdsMessages {
  nav: string;
  navGhsData: string;
  navGhsImport: string;
  title: string;
  preparing: string;
  /** GHS データ（物質 × 採用した分類の一覧、自社判定の登録、国ごとの採用順） */
  data: {
    title: string;
    lead: string;
    country: string;
    columns: { code: string; name: string; cas: string };
    empty: string;
    /** セルに添える出典の短い名前 */
    sourceShort: Record<string, string>;
    edit: {
      title: (code: string, name: string) => string;
      hazardClass: string;
      adopted: string;
      override: string;
      none: string;
      category: string;
      organs: string;
      reason: string;
      reasonHint: string;
      country: string;
      allCountries: string;
      onlyCountry: (name: string) => string;
      save: string;
      cancel: string;
      saved: string;
      needReason: string;
      needCategory: (cls: string) => string;
      existing: (n: number) => string;
    };
    rules: {
      title: string;
      lead: string;
      up: string;
      down: string;
      fill: string;
      save: string;
      saved: string;
      isDefault: string;
      adminOnly: string;
    };
  };
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
      hintEu: string;
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
      /** データ取得日: いつ取り込んだか（出典ごと）。公表の名前と公表日を添える */
      acquired: (importedOn: string, label: string, publishedOn: string) => string;
      /** 最終確認: どの公表（公表日）で最新と確認したか、いつ取り込んだか */
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
      /** 「非該当」: 出典に記載はあるが区分が付かない項目も出す。「データなし」: 出典に記載の無い項目も出す */
      showNotClassified: string;
      showNoData: string;
      /** 「出典で異なる行だけ」「H コード表示」「改訂版・年度表示」（比較の表。S23 §5-4） */
      showDiffOnly: string;
      showHCodes: string;
      showRevision: string;
      /** 列の見出し: 現行の版／将来の版（適用日から） */
      current: string;
      from: (day: string) => string;
      acquiredShort: (importedOn: string) => string;
      /** 区分の記載が無い該当（EU の Press. Gas など） */
      classifiedUnspecified: string;
      /** 改訂版・年度の 1 行 */
      revisionLine: (revision: string | null, classifiedIn: string | null) => string;
      /** 出典間で区分が違う行の印の説明 */
      differs: string;
      legend: string;
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
    navGhsData: "GHS データ",
    navGhsImport: "GHS 取り込み",
    title: "SDS 作成",
    data: {
      title: "GHS データ",
      lead: "物質ごとに、選んだ国の採用順で採った GHS 分類を並べます。行末の鉛筆から自社判定を登録できます（出典より優先されます）。",
      country: "SDS の対象の国",
      columns: { code: "物質コード", name: "名称", cas: "CAS番号" },
      empty: "該当する物質がありません",
      sourceShort: { NITE: "NITE", EU_ANNEX_VI: "EU", OVERRIDE: "自社" },
      edit: {
        title: (code, name) => `自社判定: ${code} ${name}`,
        hazardClass: "危険有害性クラス",
        adopted: "採用中",
        override: "自社判定",
        none: "（上書きしない）",
        category: "区分",
        organs: "標的臓器",
        reason: "理由",
        reasonHint:
          "出典と違う分類を採る根拠（試験報告書・仕入先 SDS など）。SDS の第 16 項と監査に使います",
        country: "効く国",
        allCountries: "全ての国",
        onlyCountry: (name) => `${name} 向けだけ`,
        save: "保存",
        cancel: "キャンセル",
        saved: "自社判定を保存しました。",
        needReason: "理由を入れてください",
        needCategory: (cls) => `「${cls}」の区分を選んでください`,
        existing: (n) => `登録済みの自社判定 ${n} 件`,
      },
      rules: {
        title: "出典の採用順",
        lead: "上から順に、その項目を評価している最初の出典を採ります。出典に記載の無い項目だけ次の出典で埋めます。",
        up: "上へ",
        down: "下へ",
        fill: "「分類できない」も次の出典で埋める",
        save: "保存",
        saved: "採用順を保存しました。",
        isDefault: "まだ保存していません（既定の並び: その国の出典が先頭）。",
        adminOnly: "採用順を変えられるのはシステム管理者だけです。",
      },
    },
    preparing: "SDS を作る機能は準備中です。まず、物質の GHS 分類の土台から作っています。",
    ghs: {
      title: "GHS 分類データ",
      lead: "国の機関が公表している物質ごとの GHS 分類を取り込みます。取り込んだ分類は、物質の詳細に出典別に出ます。",
      linkFromHome: "GHS 分類データの取り込み",
      releases: "取り込みの記録",
      noReleases: "まだ取り込んでいません。",
      columns: {
        source: "出典",
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
        hintEu:
          "ECHA の「Table of harmonised entries in Annex VI to CLP」の Excel（annex_vi_clp_table_atpNN_en.xlsx。History シート付き）を選びます。いま効いている版と、これから効く版（将来の ATP）を取り込み、適用日は行ごとに入ります。先に「下見」で件数を確かめてから「取り込む」を押してください。",
        source: "出典",
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
        title: "GHS 分類（出典別）",
        acquired: (importedOn, label, publishedOn) =>
          `データ取得日 ${importedOn}（${label}、${publishedOn} 公表）`,
        columns: {
          source: "出典",
          hazardClass: "危険有害性クラス",
          category: "区分",
          status: "状態",
          hCodes: "H コード",
          targetOrgans: "標的臓器",
          revision: "GHS 改訂",
          classifiedIn: "分類年度",
        },
        showNotClassified: "非該当",
        showNoData: "データなし",
        showDiffOnly: "出典で異なる行だけ",
        showHCodes: "H コード表示",
        showRevision: "改訂版・年度表示",
        current: "現行",
        from: (day) => `${day}〜`,
        acquiredShort: (importedOn) => `取得 ${importedOn}`,
        classifiedUnspecified: "該当（区分の記載なし）",
        revisionLine: (revision, classifiedIn) =>
          [revision ? `${revision} 版` : null, classifiedIn].filter(Boolean).join("・"),
        differs: "出典で区分が異なる",
        legend:
          "「非該当」は、出典に記載はあるが区分が付かない項目（区分に該当しない・分類できない・分類対象外）。「データなし」は、その出典がその項目に何も書いていない項目。黄色のセルと ≠ は、該当どうしで区分の文字が出典間で違う行（読み替えは段 1 で）。",
        none: "この CAS の分類は取り込まれていません。",
      },
      status: {
        CLASSIFIED: "該当",
        NOT_CLASSIFIED: "区分に該当しない",
        CANNOT_CLASSIFY: "分類できない",
        NOT_APPLICABLE: "分類対象外",
        NOT_EVALUATED: "データなし",
      },
    },
  },
  en: {
    nav: "SDS authoring",
    navGhsData: "GHS data",
    navGhsImport: "GHS import",
    title: "SDS authoring",
    data: {
      title: "GHS data",
      lead: "For each substance, the GHS classification adopted under the selected country's source order. Use the pencil at the end of a row to register your own classification (it takes precedence over the sources).",
      country: "Target country of the SDS",
      columns: { code: "Substance code", name: "Name", cas: "CAS number" },
      empty: "No matching substances",
      sourceShort: { NITE: "NITE", EU_ANNEX_VI: "EU", OVERRIDE: "own" },
      edit: {
        title: (code, name) => `Own classification: ${code} ${name}`,
        hazardClass: "Hazard class",
        adopted: "Adopted",
        override: "Own classification",
        none: "(no override)",
        category: "Category",
        organs: "Target organs",
        reason: "Reason",
        reasonHint:
          "Why you depart from the sources (test report, supplier SDS, …). Used in SDS section 16 and the audit log",
        country: "Applies to",
        allCountries: "All countries",
        onlyCountry: (name) => `${name} only`,
        save: "Save",
        cancel: "Cancel",
        saved: "Own classification saved.",
        needReason: "Enter the reason",
        needCategory: (cls) => `Choose a category for “${cls}”`,
        existing: (n) => `${n} own classification(s) registered`,
      },
      rules: {
        title: "Source order",
        lead: "Sources are consulted top to bottom; the first one that addresses a class is adopted. Only classes a source says nothing about fall through to the next source.",
        up: "Up",
        down: "Down",
        fill: "Also fall through when the source says “classification not possible”",
        save: "Save",
        saved: "Source order saved.",
        isDefault: "Not saved yet (default order: the country's own source first).",
        adminOnly: "Only system administrators can change the source order.",
      },
    },
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
        hintEu:
          "Choose ECHA’s “Table of harmonised entries in Annex VI to CLP” Excel (annex_vi_clp_table_atpNN_en.xlsx, with the History sheet). The current and upcoming (future ATP) versions are imported, with application dates per row. Run “Preview” first, then “Import”.",
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
        acquired: (importedOn, label, publishedOn) =>
          `Data acquired ${importedOn} (${label}, published ${publishedOn})`,
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
        showNotClassified: "Not classified",
        showNoData: "No data",
        showDiffOnly: "Only rows that differ between sources",
        showHCodes: "Show H codes",
        showRevision: "Show GHS revision / year",
        current: "current",
        from: (day) => `from ${day}`,
        acquiredShort: (importedOn) => `acquired ${importedOn}`,
        classifiedUnspecified: "Classified (category not stated)",
        revisionLine: (revision, classifiedIn) =>
          [revision ? `rev. ${revision}` : null, classifiedIn].filter(Boolean).join(" · "),
        differs: "Category differs between sources",
        legend:
          "“Not classified” shows classes the source addresses without assigning a category (not classified, classification not possible, not applicable). “No data” shows classes the source says nothing about. Yellow cells and ≠ mark rows whose categories differ between sources (cross-revision mapping comes in stage 1).",
        none: "No classification has been imported for this CAS.",
      },
      status: {
        CLASSIFIED: "Classified",
        NOT_CLASSIFIED: "Not classified",
        CANNOT_CLASSIFY: "Classification not possible",
        NOT_APPLICABLE: "Not applicable",
        NOT_EVALUATED: "No data",
      },
    },
  },
};

export const sdsMessages = (locale: Locale): SdsMessages => SDS_MESSAGES[locale];
