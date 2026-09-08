/**
 * IARC の正式な一覧（List of Classifications）と、名前の突き合わせの共通部分。
 *
 * 一覧は `scripts/data/iarc-official.tsv`（`scripts/build-iarc-official.py` が
 * monographs.iarc.who.int の一覧ページが読み込む JS から抜いたもの）。
 * 法文物質名はこの一覧の評価対象（Agent）で作り、LOLI・CHRIP から取った CAS の
 * 結び付きは、それぞれの名前や CAS でこの評価対象に当てる。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "scripts/data");
export const IARC_LAW = "INT-IARC";
export const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** IARC の評価対象。グループ4は廃止済みなので出てこない */
export interface OfficialAgent {
  name: string;
  /** 1 / 2A / 2B / 3 */
  group: string;
  /** 正規化前の CAS。無い評価対象（職業ばく露・放射線など）は空 */
  cas: string[];
  /** モノグラフの巻。古い順 */
  volumes: string[];
  /** 公表年（"2022 online" のような書きかたもある） */
  year: string;
  /** 評価年 */
  yearEval: string;
}

/** CHRIP・LOLI・正式一覧で共通のグループ → 区分コード */
export const CATEGORY_OF_GROUP: Record<string, string> = {
  "1": "G1",
  "2A": "G2A",
  "2B": "G2B",
  "3": "G3",
};

export function readOfficial(): OfficialAgent[] {
  const text = readFileSync(join(DATA_DIR, "iarc-official.tsv"), "utf-8");
  const out: OfficialAgent[] = [];
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "" || row.startsWith("#")) continue;
    const [name, group, cas, volumes, year, yearEval] = row.split("\t");
    if (!name || !group) continue;
    out.push({
      name,
      group,
      cas: (cas ?? "").split(";").filter(Boolean),
      volumes: (volumes ?? "").split(";").filter(Boolean),
      year: year ?? "",
      yearEval: yearEval ?? "",
    });
  }
  return out;
}

/**
 * 英語名の突き合わせ用に整える。LOLI は `Chromium(VI) compounds`、正式一覧は
 * `Chromium (VI) compounds`、Wikipedia は `Chromium[VI] compounds` と書くので、
 * 角括弧を丸括弧に寄せ、括弧の前後の空白と大小をならす
 */
export function nameKey(en: string): string {
  return (
    en
      .toLowerCase()
      // 位置の書きかたをそろえる（LOLI は m-/p-/o-、正式一覧は meta-/para-/ortho-）
      .replace(/(^|[\s,(])m-(?=[a-z])/g, "$1meta-")
      .replace(/(^|[\s,(])p-(?=[a-z])/g, "$1para-")
      .replace(/(^|[\s,(])o-(?=[a-z])/g, "$1ortho-")
      // 綴りの違い（米英）
      .replace(/fibers/g, "fibres")
      .replace(/sulphate/g, "sulfate")
      .replace(/\[/g, "(")
      .replace(/\]/g, ")")
      .replace(/\s*\(\s*/g, "(")
      .replace(/\s*\)\s*/g, ")")
      .replace(/[.,;]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** 正式な評価対象の法文物質名のコード。名前が長いので指紋にする */
export function officialCode(categoryCode: string, name: string): string {
  return `${IARC_LAW}-${categoryCode}-OF-${createHash("sha1").update(name).digest("hex").slice(0, 10)}`;
}

/** `Sup 7` → `Suppl. 7`。巻の並びはいちばん後ろが最新 */
export function latestVolume(volumes: string[]): string | null {
  const last = volumes[volumes.length - 1];
  return last ? last.replace(/^Sup\s+/i, "Suppl. ") : null;
}

/** 備考。全部の巻と年 */
export function officialNote(a: OfficialAgent): string | null {
  if (a.volumes.length === 0) return null;
  const vols = a.volumes.map((v) => v.replace(/^Sup\s+/i, "Suppl. ")).join(", ");
  const years = [a.yearEval ? `評価年 ${a.yearEval}` : "", a.year ? `公表年 ${a.year}` : ""]
    .filter(Boolean)
    .join("、");
  return `IARC モノグラフ: ${vols}${years ? `（${years}）` : ""}`;
}

/**
 * 日本語版 Wikipedia「IARC発がん性リスク一覧」から作った対応表（英語名 → 日本語名）。
 * 正式一覧と同じ名前で載っているので、くくり（「ヒ素およびヒ素化合物」など）にも付く
 */
export function readNamesJa(): Map<string, string> {
  const map = new Map<string, string>();
  let text = "";
  try {
    text = readFileSync(join(DATA_DIR, "iarc-names-ja.tsv"), "utf-8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "" || row.startsWith("#")) continue;
    const [en, ja] = row.split("\t");
    if (en && ja && !map.has(nameKey(en))) map.set(nameKey(en), ja);
  }
  return map;
}

/**
 * もっと緩い突き合わせ用。句読点・ハイフン・「and」「the」を落として語だけ並べる。
 * `Estrogens, steroidal` と `Estrogens steroidal`、`Lead, inorganic compounds` と
 * `Lead compounds, inorganic` のような語順の違いも、語を並べ替えて同じにする
 */
export function looseKey(en: string): string {
  return nameKey(en)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,;:'’.\-–]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["and", "the", "its", "of", "or"].includes(w))
    .sort()
    .join(" ");
}

/**
 * 外部データベースの名前や鍵 → 正式な評価対象の名前。
 * `scripts/data/iarc-aliases.tsv`（グループ / 外部DBの鍵か名前 / 正式な名前）。
 * 総称の書きかたが違う大きなくくり（LOLI の `Arsenic compounds` など）を手で寄せるためのもの
 */
function readAliases(group: string): Map<string, string> {
  const map = new Map<string, string>();
  let text = "";
  try {
    text = readFileSync(join(DATA_DIR, "iarc-aliases.tsv"), "utf-8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "" || row.startsWith("#")) continue;
    const [g, from, to] = row.split("\t");
    if (g === group && from && to) map.set(from, to);
  }
  return map;
}

/**
 * 塩や水和物の書きかたを落として本体の名前にする（`Hydralazine hydrochloride` → `Hydralazine`、
 * `2,4-Diaminoanisole sulfate` → `2,4-Diaminoanisole`、`Nitrilotriacetic acid, trisodium salt` → `Nitrilotriacetic acid`）。
 * IARC は本体で評価していることが多く、LOLI は塩ごとに行を持つため
 */
export function stripSalt(en: string): string {
  return en
    .replace(/\s*\(1:1\)$/i, "")
    .replace(
      /,\s*(mono|di|tri)?(sodium|potassium|ammonium|calcium|zinc|lead|barium|strontium)?\s*salts?(,?\s*(mono|di|tri)?hydrate)?$/i,
      "",
    )
    .replace(
      /\s+(mono|di|tri)?(hydrochloride|sulfate|sulphate|nitrate|acetate|phosphate|hydrate|hexahydrate|heptahydrate|trihydrate|monohydrate)$/i,
      "",
    )
    .replace(/\s+(mono|di|tri)?hydrochloride\s+(mono|di|tri)?hydrate$/i, "")
    .trim();
}

/**
 * 元素などの手がかりで、正式一覧のくくりに寄せる規則。グループごと。
 * 当てはまっても、その正式な名前がそのグループの一覧に無ければ使わない（グループ違いを防ぐ）。
 * 有機ヒ素・鉛の金属・アンチモンの三酸化物のように、正式一覧のくくりと中身が合わないものは書かない
 */
const KEYWORD_RULES: { group: string; pattern: RegExp; target: string }[] = [
  { group: "1", pattern: /cadmium/i, target: "Cadmium and cadmium compounds" },
  { group: "1", pattern: /beryllium/i, target: "Beryllium and beryllium compounds" },
  { group: "1", pattern: /nickel|pentlandite/i, target: "Nickel compounds" },
  {
    group: "1",
    pattern: /chromat|chromic acid|chromyl|chromium|molybdenum orange|zinc yellow/i,
    target: "Chromium (VI) compounds",
  },
  {
    group: "1",
    pattern:
      /arsenic (pent|tri)oxide|arsenic sulfide|arsenic acid|arsenous acid|arsenate|gallium arsenide|nickel arsenide/i,
    target: "Arsenic and inorganic arsenic compounds",
  },
  { group: "1", pattern: /aflatoxin/i, target: "Aflatoxins" },
  {
    group: "1",
    pattern: /asbestos|actinolite|anthophyllite|tremolite|crocidolite|amosite|chrysotile/i,
    target:
      "Asbestos (all forms, including actinolite, amosite, anthophyllite, chrysotile, crocidolite, tremolite)",
  },
  { group: "1", pattern: /^benzidine/i, target: "Benzidine" },
  { group: "1", pattern: /o-toluidine/i, target: "ortho-Toluidine" },
  {
    group: "1",
    pattern: /silica|cristobalite|quartz/i,
    target: "Silica dust, crystalline, in the form of quartz or cristobalite",
  },
  {
    group: "1",
    pattern: /sulfuric acid|oleum|sulfur trioxide/i,
    target: "Acid mists, strong inorganic",
  },
  { group: "1", pattern: /radon/i, target: "Radon-222 and its decay products" },
  { group: "1", pattern: /strontium-90/i, target: "Fission products, including strontium-90" },
  { group: "1", pattern: /radioiodine/i, target: "Radioiodines, including iodine-131" },
  { group: "1", pattern: /^opium/i, target: "Opium consumption" },
  { group: "1", pattern: /aristolochic acid/i, target: "Aristolochic acid" },
  {
    group: "1",
    pattern: /^uranium/i,
    target:
      "Uranium, mixture of isotopes (see Radionuclides, alpha-particle-emitting, internally deposited)",
  },
  {
    group: "2A",
    pattern:
      /^lead (nitrate|dioxide|oxide|tetraoxide|sulfide|monoxide|carbonate|sulfate|phosphate|chloride)/i,
    target: "Lead compounds, inorganic",
  },
  { group: "2A", pattern: /trivalent antimony/i, target: "Trivalent antimony" },
  { group: "2A", pattern: /glyphosate/i, target: "Glyphosate" },
  { group: "2A", pattern: /benzenamine, 4-chloro-2-methyl/i, target: "4-Chloro-ortho-toluidine" },
  {
    group: "2B",
    pattern: /nitrilotriacetic|glycine, n,n-bis\(carboxymethyl\)/i,
    target: "Nitrilotriacetic acid and its salts",
  },
  { group: "2B", pattern: /chlordane/i, target: "Chlordane" },
  { group: "2B", pattern: /heptachlor/i, target: "Heptachlor" },
  { group: "2B", pattern: /hexachlorocyclohexane/i, target: "Hexachlorocyclohexanes" },
  { group: "2B", pattern: /toluene diisocyanate/i, target: "Toluene diisocyanates" },
  { group: "2B", pattern: /1,3-benzenediamine, 4-methoxy/i, target: "2,4-Diaminoanisole" },
  {
    group: "2B",
    pattern: /3,3'-dimethylbenzidine/i,
    target: "3,3'-Dimethylbenzidine (ortho-Tolidine)",
  },
  {
    group: "2B",
    pattern: /(dichlorophenoxy|chloro-2-methylphenoxy|trichlorophenoxy)/i,
    target: "Chlorophenoxy herbicides",
  },
  {
    group: "2B",
    pattern: /nickel alloys|nickel-containing steels|metallic nickel/i,
    target: "Nickel, metallic",
  },
  { group: "2B", pattern: /^gasoline/i, target: "Gasoline" },
  {
    group: "3",
    pattern:
      /chromic|chromite|neochromium|dichromium nickel|perchloric acid, chromium|chromium hydroxide|chromium carbonyl/i,
    target: "Chromium (III) compounds",
  },
  {
    group: "3",
    pattern: /^mercuric|mercury and mercury compounds/i,
    target: "Mercury and inorganic mercury compounds",
  },
  {
    group: "3",
    pattern: /tetramethyllead|tetraethyllead|organolead/i,
    target: "Lead compounds, organic",
  },
  { group: "3", pattern: /pentavalent antimony/i, target: "Pentavalent antimony" },
  { group: "3", pattern: /hypochlorite/i, target: "Hypochlorite salts" },
  {
    group: "3",
    pattern: /bisulfite|metabisulfite/i,
    target: "Bisulfites",
  },
  {
    group: "3",
    pattern:
      /sodium fluoride|fluorides inorganic|silicofluoride|fluorosilicic|stannous fluoride|fluorspar/i,
    target: "Fluorides (inorganic, used in drinking-water)",
  },
  { group: "3", pattern: /silica, amorphous/i, target: "Silica, amorphous" },
  {
    group: "3",
    pattern: /cobalt\(ii\) compounds/i,
    target:
      "Other cobalt(II) compounds (not including Soluble cobalt(II) salts, Cobalt(II) oxide, Cobalt(II,III) oxide, and Cobalt(II) sulfide)",
  },
  {
    group: "3",
    pattern: /dibenzo-p-dioxin/i,
    target:
      "Polychlorinated dibenzo-para-dioxins (other than 2,3,7,8-tetrachlorodibenzo-para-dioxin)",
  },
  { group: "3", pattern: /phylloquinone|menadione/i, target: "Vitamin K substances" },
  { group: "3", pattern: /o-xylene/i, target: "Xylenes" },
  { group: "3", pattern: /mineral oil, highly/i, target: "Mineral oils, highly-refined" },
  { group: "3", pattern: /glass filament/i, target: "Glass filament, continuous" },
  { group: "3", pattern: /brilliant blue/i, target: "Brilliant Blue FCF, disodium salt" },
  { group: "3", pattern: /^eosin/i, target: "Eosin" },
  {
    group: "3",
    pattern: /chromium alloy|chromium-containing|cobalt-chromium/i,
    target: "Chromium, metallic",
  },
  { group: "3", pattern: /^mannomustine$/i, target: "Mannomustine dihydrochloride" },
  { group: "3", pattern: /generic mdi/i, target: "4,4'-Methylenediphenyl diisocyanate" },
  { group: "2B", pattern: /fuchsin|^magenta/i, target: "Magenta" },
];

/** グループごとの索引。名前と CAS の両方から引ける */
export class OfficialIndex {
  private byName = new Map<string, OfficialAgent>();
  private byLoose = new Map<string, OfficialAgent>();
  private byCas = new Map<string, OfficialAgent[]>();
  private aliases: Map<string, string>;
  private group: string;
  readonly agents: OfficialAgent[];

  constructor(agents: OfficialAgent[], group: string) {
    this.group = group;
    this.agents = agents.filter((a) => a.group === group);
    this.aliases = readAliases(group);
    for (const a of this.agents) {
      if (!this.byName.has(nameKey(a.name))) this.byName.set(nameKey(a.name), a);
      if (!this.byLoose.has(looseKey(a.name))) this.byLoose.set(looseKey(a.name), a);
      for (const c of a.cas) {
        const got = this.byCas.get(c) ?? [];
        got.push(a);
        this.byCas.set(c, got);
      }
    }
  }

  /**
   * 外部データベースの評価対象を、正式な評価対象に当てる。
   *   0. 対応表（scripts/data/iarc-aliases.tsv）に書いてある
   *   1. 名前が同じ（書きかたの違いはならしてから比べる。句読点や「and」の有無も無視して再挑戦）
   *   1b. 塩・水和物の語尾を落として名前で当てる / 1c. 元素などの手がかりの規則（KEYWORD_RULES）
   *   2. 自分の CAS が正式一覧のどれかの CAS に載っている
   *   3. 広げた CAS（子）が最も多く重なる評価対象
   * どれにも当たらなければ null（呼ぶ側が、その外部データベースの名前で作る）
   */
  resolve(
    name: string,
    ownCas: string | null,
    childCas: Iterable<string>,
    sourceKey?: string,
  ): OfficialAgent | null {
    const alias = (sourceKey && this.aliases.get(sourceKey)) || this.aliases.get(name);
    if (alias) {
      const target = this.byName.get(nameKey(alias));
      if (target) return target;
    }
    const byName = this.byName.get(nameKey(name));
    if (byName) return byName;
    const loose = this.byLoose.get(looseKey(name));
    if (loose) return loose;
    const stripped = stripSalt(name);
    if (stripped !== name) {
      const hit = this.byName.get(nameKey(stripped)) ?? this.byLoose.get(looseKey(stripped));
      if (hit) return hit;
    }
    for (const rule of KEYWORD_RULES) {
      if (rule.group !== this.group || !rule.pattern.test(name)) continue;
      const hit = this.byName.get(nameKey(rule.target));
      if (hit) return hit;
    }
    if (ownCas) {
      const hit = this.byCas.get(ownCas);
      if (hit?.[0]) return hit[0];
    }
    const score = new Map<OfficialAgent, number>();
    for (const c of childCas) {
      for (const a of this.byCas.get(c) ?? []) score.set(a, (score.get(a) ?? 0) + 1);
    }
    let best: OfficialAgent | null = null;
    let bestN = 0;
    for (const [a, n] of score) {
      if (n > bestN) {
        best = a;
        bestN = n;
      }
    }
    return best;
  }
}
