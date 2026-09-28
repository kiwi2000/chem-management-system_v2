/**
 * GHS の危険有害性クラス・区分のカタログ（システム共通のコード）。
 *
 * 取り込みの写像先であり、画面の表示と、段 1 の混合物の分類計算でも使う。
 * 初期データはここに置き、取り込みのたびに DB（sds_ghs_hazard_catalog）へ upsert する。
 *
 * 素材: 豪州 HCIS の区分カタログ（略号 → H コード）、NITE 統合版の 35 列（日本語名）、
 * JIS Z 7252 の区分の呼び方。**H コードはクラス×区分から一意に決まるものだけ**書く。
 * 決まらないもの（生殖毒性の D/F の別、STOT 単回 3 の H335/H336）は原典の標的臓器の文から補う
 */

export interface CatalogClass {
  /** システム共通のコード（sds_ghs_classifications.hazard_class） */
  code: string;
  nameJa: string;
  nameEn: string;
  /** 一覧の列の見出しに使う短い名前（GHS データの表。無ければ nameJa） */
  shortJa?: string;
  /** EU 風の略号（区分を後ろに付ける）。英語の一覧ではこれを見出しにする */
  abbrevEn: string;
  /** 略号が同じになるクラス（急性毒性の経路）の、英語の一覧の見出し */
  shortEn?: string;
  /** 区分と既定の H コード。区分の並びは危険の強い順 */
  categories: {
    category: string;
    hCodes?: string[];
    nameJa?: string;
    nameEn?: string;
    from?: string;
  }[];
}

const cat = (
  category: string,
  hCodes?: string[],
  extra?: { nameJa?: string; nameEn?: string; from?: string },
) => ({ category, hCodes, ...extra });

export const GHS_CATALOG: CatalogClass[] = [
  // ---- 物理化学的危険性 ----
  {
    code: "EXPL",
    nameJa: "爆発物",
    nameEn: "Explosives",
    abbrevEn: "Expl.",
    categories: [
      cat("UNSTABLE", ["H200"], { nameJa: "不安定爆発物", nameEn: "Unstable explosive" }),
      cat("1.1", ["H201"], { nameJa: "等級1.1", nameEn: "Division 1.1" }),
      cat("1.2", ["H202"], { nameJa: "等級1.2", nameEn: "Division 1.2" }),
      cat("1.3", ["H203"], { nameJa: "等級1.3", nameEn: "Division 1.3" }),
      cat("1.4", ["H204"], { nameJa: "等級1.4", nameEn: "Division 1.4" }),
      cat("1.5", ["H205"], { nameJa: "等級1.5", nameEn: "Division 1.5" }),
      cat("1.6", [], { nameJa: "等級1.6", nameEn: "Division 1.6" }),
      cat("UNSPEC", [], {
        nameJa: "爆発物（等級の記載なし）",
        nameEn: "Explosive (division not stated)",
      }),
    ],
  },
  {
    code: "FLAM_GAS",
    nameJa: "可燃性ガス",
    nameEn: "Flammable gases",
    abbrevEn: "Flam. Gas",
    categories: [
      cat("1", ["H220"]),
      cat("1A", ["H220"], { from: "6" }),
      cat("1B", ["H221"], { from: "6" }),
      cat("2", ["H221"]),
    ],
  },
  {
    code: "PYR_GAS",
    nameJa: "自然発火性ガス",
    nameEn: "Pyrophoric gases",
    abbrevEn: "Pyr. Gas",
    categories: [cat("1", ["H232"], { from: "6" })],
  },
  {
    code: "CHEM_UNST_GAS",
    nameJa: "化学的に不安定なガス",
    shortJa: "化学不安定ガス",
    nameEn: "Chemically unstable gases",
    abbrevEn: "Chem. Unst. Gas",
    categories: [cat("A", ["H230"], { from: "4" }), cat("B", ["H231"], { from: "4" })],
  },
  {
    code: "AEROSOL",
    nameJa: "エアゾール",
    nameEn: "Aerosols",
    abbrevEn: "Aerosol",
    categories: [cat("1", ["H222", "H229"]), cat("2", ["H223", "H229"]), cat("3", ["H229"])],
  },
  {
    code: "OX_GAS",
    nameJa: "酸化性ガス",
    nameEn: "Oxidising gases",
    abbrevEn: "Ox. Gas",
    categories: [cat("1", ["H270"])],
  },
  {
    code: "PRESS_GAS",
    nameJa: "高圧ガス",
    nameEn: "Gases under pressure",
    abbrevEn: "Press. Gas",
    categories: [
      cat("COMPRESSED", ["H280"], { nameJa: "圧縮ガス", nameEn: "Compressed gas" }),
      cat("LIQUEFIED", ["H280"], { nameJa: "液化ガス", nameEn: "Liquefied gas" }),
      cat("REFRIG_LIQ", ["H281"], {
        nameJa: "深冷液化ガス",
        nameEn: "Refrigerated liquefied gas",
      }),
      cat("DISSOLVED", ["H280"], { nameJa: "溶解ガス", nameEn: "Dissolved gas" }),
      // EU 附属書VI は「Press. Gas」とだけ書き、種類を分けない
      cat("UNSPEC", ["H280"], {
        nameJa: "高圧ガス（種類の記載なし）",
        nameEn: "Gas under pressure (type not stated)",
      }),
    ],
  },
  {
    code: "FLAM_LIQ",
    nameJa: "引火性液体",
    nameEn: "Flammable liquids",
    abbrevEn: "Flam. Liq.",
    categories: [cat("1", ["H224"]), cat("2", ["H225"]), cat("3", ["H226"]), cat("4", ["H227"])],
  },
  {
    code: "FLAM_SOL",
    nameJa: "可燃性固体",
    nameEn: "Flammable solids",
    abbrevEn: "Flam. Sol.",
    categories: [cat("1", ["H228"]), cat("2", ["H228"])],
  },
  {
    code: "SELF_REACT",
    nameJa: "自己反応性化学品",
    shortJa: "自己反応性",
    nameEn: "Self-reactive substances and mixtures",
    abbrevEn: "Self-react.",
    categories: [
      cat("A", ["H240"], { nameJa: "タイプA", nameEn: "Type A" }),
      cat("B", ["H241"], { nameJa: "タイプB", nameEn: "Type B" }),
      cat("C", ["H242"], { nameJa: "タイプC", nameEn: "Type C" }),
      cat("D", ["H242"], { nameJa: "タイプD", nameEn: "Type D" }),
      cat("E", ["H242"], { nameJa: "タイプE", nameEn: "Type E" }),
      cat("F", ["H242"], { nameJa: "タイプF", nameEn: "Type F" }),
      cat("G", [], { nameJa: "タイプG", nameEn: "Type G" }),
    ],
  },
  {
    code: "PYR_LIQ",
    nameJa: "自然発火性液体",
    nameEn: "Pyrophoric liquids",
    abbrevEn: "Pyr. Liq.",
    categories: [cat("1", ["H250"])],
  },
  {
    code: "PYR_SOL",
    nameJa: "自然発火性固体",
    nameEn: "Pyrophoric solids",
    abbrevEn: "Pyr. Sol.",
    categories: [cat("1", ["H250"])],
  },
  {
    code: "SELF_HEAT",
    nameJa: "自己発熱性化学品",
    shortJa: "自己発熱性",
    nameEn: "Self-heating substances and mixtures",
    abbrevEn: "Self-heat.",
    categories: [cat("1", ["H251"]), cat("2", ["H252"])],
  },
  {
    code: "WATER_REACT",
    nameJa: "水反応可燃性化学品",
    shortJa: "水反応可燃性",
    nameEn: "Substances and mixtures which, in contact with water, emit flammable gases",
    abbrevEn: "Water-react.",
    categories: [cat("1", ["H260"]), cat("2", ["H261"]), cat("3", ["H261"])],
  },
  {
    code: "OX_LIQ",
    nameJa: "酸化性液体",
    nameEn: "Oxidising liquids",
    abbrevEn: "Ox. Liq.",
    categories: [cat("1", ["H271"]), cat("2", ["H272"]), cat("3", ["H272"])],
  },
  {
    code: "OX_SOL",
    nameJa: "酸化性固体",
    nameEn: "Oxidising solids",
    abbrevEn: "Ox. Sol.",
    categories: [cat("1", ["H271"]), cat("2", ["H272"]), cat("3", ["H272"])],
  },
  {
    code: "ORG_PEROX",
    nameJa: "有機過酸化物",
    nameEn: "Organic peroxides",
    abbrevEn: "Org. Perox.",
    categories: [
      cat("A", ["H240"], { nameJa: "タイプA", nameEn: "Type A" }),
      cat("B", ["H241"], { nameJa: "タイプB", nameEn: "Type B" }),
      cat("C", ["H242"], { nameJa: "タイプC", nameEn: "Type C" }),
      cat("D", ["H242"], { nameJa: "タイプD", nameEn: "Type D" }),
      cat("E", ["H242"], { nameJa: "タイプE", nameEn: "Type E" }),
      cat("F", ["H242"], { nameJa: "タイプF", nameEn: "Type F" }),
      cat("G", [], { nameJa: "タイプG", nameEn: "Type G" }),
    ],
  },
  {
    code: "MET_CORR",
    nameJa: "金属腐食性化学品",
    shortJa: "金属腐食性",
    nameEn: "Corrosive to metals",
    abbrevEn: "Met. Corr.",
    categories: [cat("1", ["H290"])],
  },
  {
    code: "DESENS_EXPL",
    nameJa: "鈍性化爆発物",
    nameEn: "Desensitised explosives",
    abbrevEn: "Desens. Expl.",
    categories: [
      cat("1", ["H206"], { from: "6" }),
      cat("2", ["H207"], { from: "6" }),
      cat("3", ["H207"], { from: "6" }),
      cat("4", ["H208"], { from: "6" }),
    ],
  },
  // ---- 健康有害性 ----
  {
    code: "ACUTE_TOX_ORAL",
    nameJa: "急性毒性（経口）",
    shortJa: "急性毒性 経口",
    nameEn: "Acute toxicity (oral)",
    abbrevEn: "Acute Tox.",
    shortEn: "Acute Tox. oral",
    categories: [
      cat("1", ["H300"]),
      cat("2", ["H300"]),
      cat("3", ["H301"]),
      cat("4", ["H302"]),
      cat("5", ["H303"]),
    ],
  },
  {
    code: "ACUTE_TOX_DERMAL",
    nameJa: "急性毒性（経皮）",
    shortJa: "急性毒性 経皮",
    nameEn: "Acute toxicity (dermal)",
    abbrevEn: "Acute Tox.",
    shortEn: "Acute Tox. dermal",
    categories: [
      cat("1", ["H310"]),
      cat("2", ["H310"]),
      cat("3", ["H311"]),
      cat("4", ["H312"]),
      cat("5", ["H313"]),
    ],
  },
  {
    code: "ACUTE_TOX_INHAL_GAS",
    nameJa: "急性毒性（吸入：ガス）",
    shortJa: "急性毒性 吸入ガス",
    nameEn: "Acute toxicity (inhalation: gases)",
    abbrevEn: "Acute Tox.",
    shortEn: "Acute Tox. inh. gas",
    categories: [
      cat("1", ["H330"]),
      cat("2", ["H330"]),
      cat("3", ["H331"]),
      cat("4", ["H332"]),
      cat("5", ["H333"]),
    ],
  },
  {
    code: "ACUTE_TOX_INHAL_VAPOUR",
    nameJa: "急性毒性（吸入：蒸気）",
    shortJa: "急性毒性 吸入蒸気",
    nameEn: "Acute toxicity (inhalation: vapours)",
    abbrevEn: "Acute Tox.",
    shortEn: "Acute Tox. inh. vapour",
    categories: [
      cat("1", ["H330"]),
      cat("2", ["H330"]),
      cat("3", ["H331"]),
      cat("4", ["H332"]),
      cat("5", ["H333"]),
    ],
  },
  {
    code: "ACUTE_TOX_INHAL_DUST",
    nameJa: "急性毒性（吸入：粉塵、ミスト）",
    shortJa: "急性毒性 吸入粉塵",
    nameEn: "Acute toxicity (inhalation: dusts and mists)",
    abbrevEn: "Acute Tox.",
    shortEn: "Acute Tox. inh. dust",
    categories: [
      cat("1", ["H330"]),
      cat("2", ["H330"]),
      cat("3", ["H331"]),
      cat("4", ["H332"]),
      cat("5", ["H333"]),
    ],
  },
  {
    // EU 附属書VI は吸入の経路（ガス・蒸気・粉塵）を分けない
    code: "ACUTE_TOX_INHAL",
    nameJa: "急性毒性（吸入：経路の記載なし）",
    shortJa: "急性毒性 吸入",
    nameEn: "Acute toxicity (inhalation, route not stated)",
    abbrevEn: "Acute Tox.",
    shortEn: "Acute Tox. inh.",
    categories: [
      cat("1", ["H330"]),
      cat("2", ["H330"]),
      cat("3", ["H331"]),
      cat("4", ["H332"]),
      cat("5", ["H333"]),
    ],
  },
  {
    code: "SKIN_CORR_IRRIT",
    nameJa: "皮膚腐食性／刺激性",
    shortJa: "皮膚腐食／刺激",
    nameEn: "Skin corrosion/irritation",
    abbrevEn: "Skin Corr./Irrit.",
    categories: [
      cat("1", ["H314"]),
      cat("1A", ["H314"]),
      cat("1B", ["H314"]),
      cat("1C", ["H314"]),
      cat("2", ["H315"]),
      cat("3", ["H316"]),
    ],
  },
  {
    code: "EYE_DAM_IRRIT",
    nameJa: "眼に対する重篤な損傷性／眼刺激性",
    shortJa: "眼損傷／刺激",
    nameEn: "Serious eye damage/eye irritation",
    abbrevEn: "Eye Dam./Irrit.",
    categories: [cat("1", ["H318"]), cat("2", ["H319"]), cat("2A", ["H319"]), cat("2B", ["H320"])],
  },
  {
    code: "RESP_SENS",
    nameJa: "呼吸器感作性",
    nameEn: "Respiratory sensitisation",
    abbrevEn: "Resp. Sens.",
    categories: [cat("1", ["H334"]), cat("1A", ["H334"]), cat("1B", ["H334"])],
  },
  {
    code: "SKIN_SENS",
    nameJa: "皮膚感作性",
    nameEn: "Skin sensitisation",
    abbrevEn: "Skin Sens.",
    categories: [cat("1", ["H317"]), cat("1A", ["H317"]), cat("1B", ["H317"])],
  },
  {
    code: "MUTA",
    nameJa: "生殖細胞変異原性",
    shortJa: "変異原性",
    nameEn: "Germ cell mutagenicity",
    abbrevEn: "Muta.",
    categories: [cat("1", ["H340"]), cat("1A", ["H340"]), cat("1B", ["H340"]), cat("2", ["H341"])],
  },
  {
    code: "CARC",
    nameJa: "発がん性",
    nameEn: "Carcinogenicity",
    abbrevEn: "Carc.",
    categories: [cat("1", ["H350"]), cat("1A", ["H350"]), cat("1B", ["H350"]), cat("2", ["H351"])],
  },
  {
    code: "REPR",
    nameJa: "生殖毒性",
    nameEn: "Reproductive toxicity",
    abbrevEn: "Repr.",
    categories: [
      cat("1", ["H360"]),
      cat("1A", ["H360"]),
      cat("1B", ["H360"]),
      cat("2", ["H361"]),
      cat("LACT", ["H362"], {
        nameJa: "追加区分（授乳）",
        nameEn: "Additional category for effects on or via lactation",
      }),
    ],
  },
  {
    code: "STOT_SE",
    nameJa: "特定標的臓器毒性（単回暴露）",
    shortJa: "STOT 単回",
    nameEn: "Specific target organ toxicity (single exposure)",
    abbrevEn: "STOT SE",
    // 区分 3 の H は標的臓器の文で決まる（気道刺激性 H335／麻酔作用 H336）ので、ここには書かない
    categories: [cat("1", ["H370"]), cat("2", ["H371"]), cat("3")],
  },
  {
    code: "STOT_RE",
    nameJa: "特定標的臓器毒性（反復暴露）",
    shortJa: "STOT 反復",
    nameEn: "Specific target organ toxicity (repeated exposure)",
    abbrevEn: "STOT RE",
    categories: [cat("1", ["H372"]), cat("2", ["H373"])],
  },
  {
    code: "ASP_TOX",
    nameJa: "誤えん有害性",
    nameEn: "Aspiration hazard",
    abbrevEn: "Asp. Tox.",
    categories: [cat("1", ["H304"]), cat("2", ["H305"])],
  },
  // ---- 環境有害性 ----
  {
    code: "AQUATIC_ACUTE",
    nameJa: "水生環境有害性 短期（急性）",
    shortJa: "水生 急性",
    nameEn: "Hazardous to the aquatic environment (acute)",
    abbrevEn: "Aquatic Acute",
    categories: [cat("1", ["H400"]), cat("2", ["H401"]), cat("3", ["H402"])],
  },
  {
    code: "AQUATIC_CHRONIC",
    nameJa: "水生環境有害性 長期（慢性）",
    shortJa: "水生 慢性",
    nameEn: "Hazardous to the aquatic environment (chronic)",
    abbrevEn: "Aquatic Chronic",
    categories: [cat("1", ["H410"]), cat("2", ["H411"]), cat("3", ["H412"]), cat("4", ["H413"])],
  },
  {
    code: "OZONE",
    nameJa: "オゾン層への有害性",
    shortJa: "オゾン層",
    nameEn: "Hazardous to the ozone layer",
    abbrevEn: "Ozone",
    categories: [cat("1", ["H420"])],
  },
];

/** クラスコード → カタログ */
export const CATALOG_BY_CODE: ReadonlyMap<string, CatalogClass> = new Map(
  GHS_CATALOG.map((c) => [c.code, c]),
);

/** クラス × 区分 の既定の H コード（無ければ空） */
export function defaultHCodes(hazardClass: string, category: string): string[] {
  const c = CATALOG_BY_CODE.get(hazardClass);
  return c?.categories.find((k) => k.category === category)?.hCodes ?? [];
}

/** 表示の並び（カタログの順） */
export function classSortOrder(hazardClass: string): number {
  const i = GHS_CATALOG.findIndex((c) => c.code === hazardClass);
  return i < 0 ? 999 : i;
}
