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
  /** 製品の詳細の「GHS 判定」 */
  judgement: {
    title: (country: string) => string;
    lead: string;
    compute: string;
    recompute: string;
    computing: string;
    notComputed: string;
    computedAt: (at: string, asOf: string) => string;
    layers: (layers: string) => string;
    hazardClass: string;
    result: string;
    notes: string;
    needsJudgement: string;
    noResult: string;
    category: (c: string) => string;
    /** 授乳影響のような、区分の番号を持たない追加の分類 */
    categoryAdditional: string;
    outcome: Record<"not_classified" | "unclassifiable" | "not_applicable", string>;
    basis: string;
    basisHidden: string;
    basisIngredients: string;
    basisIngredientName: string;
    basisPct: string;
    basisIncluded: string;
    basisExcluded: string;
    basisFlag: (flag: string) => string;
    basisValues: string;
    basisStep: string;
    basisCondition: (text: string, result: boolean) => string;
    basisAssign: (name: string, value: string, text: string) => string;
    basisClassify: (category: string) => string;
    basisBands: (value: string, category: string | null) => string;
    basisCapped: (from: string, to: string) => string;
    basisOption: (name: string, value: string, by: string) => string;
    basisOutcome: (outcome: string) => string;
    noteCode: Record<
      "missing_value" | "excluded_category" | "capped_at_ingredient",
      (p: Record<string, string>) => string
    >;
    judgementCode: Record<"blocked_materials", string>;
    blocked: (names: string) => string;
    remapped: (from: string) => string;
    expandAll: string;
    collapseAll: string;
    loadFailed: (status: number) => string;
  };
}

export const SDS_MESSAGES: Record<Locale, SdsMessages> = {
  ja: {
    nav: "SDS 作成",
    title: "SDS 作成",
    preparing:
      "SDS を作る機能は準備中です。物質の GHS 分類は、法規制の「GHS分類データ」で見られます。",
    linkGhsData: "GHS分類データ",
    judgement: {
      title: (country) => `GHS 判定（${country}）`,
      lead: "組成と成分の GHS 分類データから、この製品の混合物としての区分を決めます。各行を開くと、どの成分と条件で決まったかが見られます。",
      compute: "判定する",
      recompute: "判定し直す",
      computing: "判定中…",
      notComputed: "まだ判定していません。「判定する」を押すと、いまの組成で計算します。",
      computedAt: (at, asOf) => `判定 ${at}（判定対象日 ${asOf}）`,
      layers: (layers) => `使った決まり: ${layers}`,
      hazardClass: "危険有害性クラス",
      result: "結果",
      notes: "注記",
      needsJudgement: "要判断",
      noResult: "判断待ち（試験データが要る）",
      category: (c) => (c === "additional" ? "追加区分（該当）" : `区分 ${c}`),
      categoryAdditional: "追加区分（該当）",
      outcome: {
        not_classified: "区分に該当しない",
        unclassifiable: "分類できない",
        not_applicable: "当てはまらない",
      },
      basis: "根拠",
      basisHidden: "根拠（成分と含有率）は組成を見られる人にだけ出ます",
      basisIngredients: "考慮した成分",
      basisIngredientName: "成分",
      basisPct: "含有率",
      basisIncluded: "考慮する",
      basisExcluded: "外す",
      basisFlag: (flag) => `印: ${flag}`,
      basisValues: "成分ごとの値",
      basisStep: "計算の流れ",
      basisCondition: (text, result) => `${text} → ${result ? "はい" : "いいえ"}`,
      basisAssign: (name, value, text) => `${name} = ${value}（${text}）`,
      basisClassify: (category) => `区分 ${category} と決めた`,
      basisBands: (value, category) =>
        category ? `値 ${value} を帯に当てて区分 ${category}` : `値 ${value} はどの帯にも入らない`,
      basisCapped: (from, to) => `式では区分 ${from} だが、最も重い成分の区分 ${to} に止めた`,
      basisOption: (name, value, by) => `選択点 ${name} = ${value}（${by}）`,
      basisOutcome: (outcome) => `結果: ${outcome}`,
      noteCode: {
        missing_value: () => "計算に必要な値が無いので分類できない",
        excluded_category: (p) =>
          `区分 ${p.category} はこの国では採用していないので「${p.result === "not_classified" ? "区分に該当しない" : "分類できない"}」`,
        capped_at_ingredient: (p) =>
          `式では区分 ${p.computed} だが、最も重い成分の区分 ${p.category} に止めた`,
      },
      judgementCode: {
        blocked_materials: "開けなかった原材料があるため、組成が不完全",
      },
      blocked: (names) => `開けなかった原材料: ${names}`,
      remapped: (from) => `（国連の式では区分 ${from}）`,
      expandAll: "すべて開く",
      collapseAll: "すべて閉じる",
      loadFailed: (status) => `読み込めませんでした（${status}）`,
    },
  },
  en: {
    nav: "SDS authoring",
    title: "SDS authoring",
    preparing:
      "SDS authoring is in preparation. Substance GHS classifications are under Regulations › GHS classification data.",
    linkGhsData: "GHS classification data",
    judgement: {
      title: (country) => `GHS classification (${country})`,
      lead: "Classifies this product as a mixture from its composition and the ingredients' GHS data. Open a row to see which ingredients and conditions decided it.",
      compute: "Classify",
      recompute: "Classify again",
      computing: "Classifying…",
      notComputed: "Not classified yet. Press Classify to compute from the current composition.",
      computedAt: (at, asOf) => `Classified ${at} (as of ${asOf})`,
      layers: (layers) => `Rules used: ${layers}`,
      hazardClass: "Hazard class",
      result: "Result",
      notes: "Notes",
      needsJudgement: "Needs judgement",
      noResult: "Pending (test data required)",
      category: (c) => (c === "additional" ? "Additional category (applies)" : `Category ${c}`),
      categoryAdditional: "Additional category (applies)",
      outcome: {
        not_classified: "Not classified",
        unclassifiable: "Classification not possible",
        not_applicable: "Not applicable",
      },
      basis: "Basis",
      basisHidden:
        "The basis (ingredients and percentages) is shown only to people who can view the composition",
      basisIngredients: "Ingredients considered",
      basisIngredientName: "Ingredient",
      basisPct: "Content",
      basisIncluded: "considered",
      basisExcluded: "excluded",
      basisFlag: (flag) => `flag: ${flag}`,
      basisValues: "Values per ingredient",
      basisStep: "Calculation",
      basisCondition: (text, result) => `${text} → ${result ? "yes" : "no"}`,
      basisAssign: (name, value, text) => `${name} = ${value}  (${text})`,
      basisClassify: (category) => `Classified as Category ${category}`,
      basisBands: (value, category) =>
        category
          ? `Value ${value} falls in Category ${category}`
          : `Value ${value} falls in no band`,
      basisCapped: (from, to) =>
        `Formula gives Category ${from}; capped at the most severe ingredient's Category ${to}`,
      basisOption: (name, value, by) => `Option ${name} = ${value} (${by})`,
      basisOutcome: (outcome) => `Result: ${outcome}`,
      noteCode: {
        missing_value: () => "A value needed for the calculation is missing",
        excluded_category: (p) =>
          `Category ${p.category} is not adopted in this country, so "${p.result === "not_classified" ? "not classified" : "classification not possible"}"`,
        capped_at_ingredient: (p) =>
          `Formula gives Category ${p.computed}; capped at the most severe ingredient's Category ${p.category}`,
      },
      judgementCode: {
        blocked_materials: "Some materials could not be opened, so the composition is incomplete",
      },
      blocked: (names) => `Materials not opened: ${names}`,
      remapped: (from) => `(UN formula: Category ${from})`,
      expandAll: "Expand all",
      collapseAll: "Collapse all",
      loadFailed: (status) => `Could not load (${status})`,
    },
  },
};

export const sdsMessages = (locale: Locale): SdsMessages => SDS_MESSAGES[locale];
