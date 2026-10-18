import { COMPOSITION_MAX_DEPTH, normalizeCode } from "@chem/shared";
import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { COMPOSITION_INCLUDE } from "@/lib/composition-service";
import { prisma } from "@/lib/db";
import { adoptForSubstances, type AdoptedCell } from "@/lib/ghs/adopt";
import { categoryRank } from "@/lib/ghs/catalog-data";
import { todayInJapan } from "@/lib/judgement-date";
import { visibilityWhere } from "@/lib/product-service";
import {
  classifyClass,
  merge,
  type ClassResult,
  type Ingredient,
  type Merged,
  type Mixture,
} from "../rules/engine";
import type { Ruleset } from "../rules/generated/ast";
import { BUILTIN_RULESET_TEXTS } from "../rules/generated/rulesets";
import { parseRuleset } from "../rules/services";

/**
 * 製品の GHS 判定（SDS 版。S27 §5 の 4）。
 *
 * 1. 製品の組成を末端の物質まで下ろし、同じ CAS（無ければ物質）ごとに含有率を足す
 * 2. 成分ごとに、その国の採用順で GHS 分類（lib/ghs/adopt.ts）と、物質の拡張属性（LD50・M 係数・印）を集める
 * 3. 国のレイヤーのルールセット（国連を土台に重ねたもの）で全クラスを判定し、根拠（実行の記録）ごと保存する
 *
 * 成分の分類の読み替え（ADVISOR の指摘で 1 か所に集める）:
 *   CLASSIFIED → その区分、CANNOT_CLASSIFY / NOT_EVALUATED / 出典なし → 未知、
 *   NOT_CLASSIFIED / NOT_APPLICABLE → 評価済みで「区分に該当しない」（未知ではない。加算式では薄めるだけ）
 */

/** 国のコード → いちばん上のレイヤー（ルールセット名@版） */
const COUNTRY_RULESETS: Record<string, { name: string; version: number }> = {
  JP: { name: "JP-JIS2025", version: 1 },
  UN: { name: "UN-Rev9", version: 1 },
};

/** GHS 分類データのカタログのクラス → ルール言語のクラス名。吸入の経路なしは 3 つに配る */
const CLASS_MAP: Record<string, string[]> = {
  EXPL: ["explosive"],
  FLAM_GAS: ["flammable_gas"],
  AEROSOL: ["aerosol"],
  OX_GAS: ["oxidizing_gas"],
  PRESS_GAS: ["gas_under_pressure"],
  FLAM_LIQ: ["flammable_liquid"],
  FLAM_SOL: ["flammable_solid"],
  SELF_REACT: ["self_reactive"],
  PYR_LIQ: ["pyrophoric_liquid"],
  PYR_SOL: ["pyrophoric_solid"],
  SELF_HEAT: ["self_heating"],
  WATER_REACT: ["water_reactive"],
  OX_LIQ: ["oxidizing_liquid"],
  OX_SOL: ["oxidizing_solid"],
  ORG_PEROX: ["organic_peroxide"],
  MET_CORR: ["corrosive_to_metals"],
  DESENS_EXPL: ["desensitized_explosive"],
  ACUTE_TOX_ORAL: ["acute.oral"],
  ACUTE_TOX_DERMAL: ["acute.dermal"],
  ACUTE_TOX_INHAL_GAS: ["acute.gas"],
  ACUTE_TOX_INHAL_VAPOUR: ["acute.vapour"],
  ACUTE_TOX_INHAL_DUST: ["acute.dust"],
  ACUTE_TOX_INHAL: ["acute.gas", "acute.vapour", "acute.dust"],
  SKIN_CORR_IRRIT: ["skin"],
  EYE_DAM_IRRIT: ["eye"],
  RESP_SENS: ["resp_sens"],
  SKIN_SENS: ["skin_sens"],
  MUTA: ["muta"],
  CARC: ["carc"],
  REPR: ["repr"],
  STOT_SE: ["stot_se"],
  STOT_RE: ["stot_re"],
  ASP_TOX: ["aspiration"],
  AQUATIC_ACUTE: ["aquatic.acute"],
  AQUATIC_CHRONIC: ["aquatic.chronic"],
  OZONE: ["ozone"],
};

/** 物質の拡張属性のキー → ルール言語の値の名前 */
const VALUE_KEYS: Record<string, string> = {
  ld50_oral: "ate.oral",
  ld50_dermal: "ate.dermal",
  lc50_inhalation_gas: "ate.gas",
  lc50_inhalation_vapour: "ate.vapour",
  lc50_inhalation_dust: "ate.dust",
  m_factor_acute: "m_factor_acute",
  m_factor_chronic: "m_factor_chronic",
};

/** 物質の拡張属性（はい／いいえ）→ 成分の印 */
const FLAG_KEYS: Record<string, string> = {
  ghs_relevant_below_cutoff: "relevant",
  ghs_non_additive: "non_additive",
  ghs_no_acute_toxicity: "no_acute_toxicity",
};

/** 製品の拡張属性のうち、ルールが読むもの（キーそのまま） */
const PRODUCT_KEYS = new Set([
  "physical_state",
  "form",
  "ph",
  "flash_point",
  "initial_boiling_point",
  "kinematic_viscosity_40c",
]);

/** 計算に使った成分の写し（保存する） */
export interface IngredientSnapshot {
  substanceId: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  cas: string | null;
  /** 含有率（%、文字列。足し合わせは decimal で行い、丸めない） */
  pct: string;
  categories: Record<string, string>;
  unknown: string[];
  noHazard: string[];
  values: Record<string, number>;
  flags: string[];
  /** クラスごとの出どころ（上書き／出典のコード） */
  from: Record<string, string>;
}

export interface JudgementInputs {
  ingredients: IngredientSnapshot[];
  product: Record<string, number | string>;
  blocked: { code: string; nameJa: string; nameEn: string | null; reason: "empty" | "notFound" }[];
}

export interface ProductGhsJudgementDto {
  productId: string;
  country: string;
  rulesetName: string;
  rulesetVersion: number;
  layers: string[];
  asOf: string;
  computedAt: string;
  computedBy: string | null;
  /** クラスの表示名（ルールセットの label） */
  classLabels: Record<string, string>;
  results: ClassResult[];
  inputs: JudgementInputs;
}

// ---------- ルールセット ----------

let registryPromise: Promise<Map<string, Ruleset>> | null = null;

/** 同梱のルールセットを読んで名前@版で引けるようにする（1 回だけ） */
function registry(): Promise<Map<string, Ruleset>> {
  registryPromise ??= (async () => {
    const out = new Map<string, Ruleset>();
    for (const [file, text] of Object.entries(BUILTIN_RULESET_TEXTS)) {
      const r = await parseRuleset(text, file);
      if (!r.ruleset || r.errors.length > 0) {
        throw new Error(`ルールセット ${file} が読めません: ${JSON.stringify(r.errors[0])}`);
      }
      out.set(`${r.ruleset.name}@${r.ruleset.version}`, r.ruleset);
    }
    return out;
  })();
  return registryPromise;
}

const mergedCache = new Map<string, Promise<Merged>>();

/** その国のレイヤーを土台から重ね合わせたもの（国ごとに 1 回だけ） */
export async function mergedFor(country: string): Promise<Merged> {
  const top = COUNTRY_RULESETS[country];
  if (!top) throw new Error(`この国のルールセットはまだありません: ${country}`);
  let p = mergedCache.get(country);
  if (!p) {
    p = registry().then((reg) => {
      const rs = reg.get(`${top.name}@${top.version}`);
      if (!rs) throw new Error(`ルールセットがありません: ${top.name}@${top.version}`);
      const m = merge(rs, reg);
      if (m.problems.length > 0)
        throw new Error(`ルールセットに問題があります: ${m.problems.join(" / ")}`);
      return m;
    });
    mergedCache.set(country, p);
  }
  return p;
}

// ---------- 成分の読み替え ----------

/** 成分の採用結果（GHS 分類データ）を、ルール言語の区分・未知・該当しないに読み替える（純粋な関数。試験あり） */
export function applyAdoptedCells(
  target: {
    categories: Map<string, string>;
    unknown: Set<string>;
    noHazard: Set<string>;
    from: Map<string, string>;
  },
  cells: AdoptedCell[],
): void {
  const seen = new Set<string>();
  // 経路なしの吸入は、経路ありのものが無いクラスにだけ配る（先に経路ありを見る）
  const ordered = [...cells].sort(
    (a, b) =>
      (a.hazardClass === "ACUTE_TOX_INHAL" ? 1 : 0) - (b.hazardClass === "ACUTE_TOX_INHAL" ? 1 : 0),
  );
  for (const cell of ordered) {
    const classes = CLASS_MAP[cell.hazardClass];
    if (!classes) continue;
    for (const cls of classes) {
      if (seen.has(cls)) continue;
      if (cell.status === "NOT_EVALUATED" && cell.hazardClass === "ACUTE_TOX_INHAL") continue;
      seen.add(cls);
      if (cell.from) target.from.set(cls, cell.from);
      switch (cell.status) {
        case "CLASSIFIED": {
          // 授乳影響はカタログでは生殖毒性の区分 LACT。ルール言語では別のクラス
          const items = cell.items.filter((i) => i.category !== "LACT");
          if (cls === "repr" && cell.items.some((i) => i.category === "LACT")) {
            target.categories.set("lactation", "additional");
          }
          if (items.length === 0) {
            if (cls === "repr") target.noHazard.add(cls);
            break;
          }
          // 区分が複数あれば最も重いもの（カタログの並び）
          const best = [...items].sort(
            (a, b) =>
              categoryRank(cell.hazardClass, a.category) -
              categoryRank(cell.hazardClass, b.category),
          )[0]!;
          target.categories.set(cls, best.category);
          break;
        }
        case "NOT_CLASSIFIED":
        case "NOT_APPLICABLE":
          target.noHazard.add(cls);
          break;
        default:
          target.unknown.add(cls);
      }
    }
  }
}

// ---------- 組成 ----------

interface Collected {
  substanceId: string;
  code: string;
  nameJa: string;
  nameEn: string | null;
  cas: string | null;
  casNormalized: string | null;
  pct: Prisma.Decimal;
}

/** 組成を末端の物質まで下ろし、同じ CAS（無ければ物質）ごとに含有率を足す。開けなかった原材料は blocked に */
async function collectIngredients(
  actor: Actor,
  rootProductId: string,
): Promise<{ rows: Collected[]; blocked: JudgementInputs["blocked"] }> {
  const byKey = new Map<string, Collected>();
  const blocked: JudgementInputs["blocked"] = [];
  async function walk(productId: string, ratio: Prisma.Decimal, depth: number): Promise<void> {
    const lines = await prisma.compositionLine.findMany({
      where: { parentProductId: productId },
      include: COMPOSITION_INCLUDE,
      orderBy: { displayOrder: "asc" },
    });
    for (const line of lines) {
      if (line.contentPct === null) continue;
      const pct = ratio.mul(line.contentPct.toString()).div(100);
      if (line.substance) {
        const s = line.substance;
        const casNormalized = s.casNumber ? normalizeCode(s.casNumber) : null;
        const key = casNormalized ? `cas:${casNormalized}` : `sub:${s.id}`;
        const cur = byKey.get(key);
        if (cur) cur.pct = cur.pct.add(pct);
        else
          byKey.set(key, {
            substanceId: s.id,
            code: s.code,
            nameJa: s.nameJa,
            nameEn: s.nameEn,
            cas: s.casNumber,
            casNormalized,
            pct,
          });
        continue;
      }
      if (!line.childProduct) continue;
      const c = line.childProduct;
      const visible = await prisma.product.findFirst({
        where: { id: c.id, deletedAt: null, ...visibilityWhere(actor) },
        select: { id: true },
      });
      if (!visible || depth >= COMPOSITION_MAX_DEPTH) {
        blocked.push({ code: c.code, nameJa: c.nameJa, nameEn: c.nameEn, reason: "notFound" });
        continue;
      }
      const childLines = await prisma.compositionLine.count({ where: { parentProductId: c.id } });
      if (childLines === 0) {
        blocked.push({ code: c.code, nameJa: c.nameJa, nameEn: c.nameEn, reason: "empty" });
        continue;
      }
      await walk(c.id, pct, depth + 1);
    }
  }
  await walk(rootProductId, new Prisma.Decimal(100), 0);
  return { rows: [...byKey.values()], blocked };
}

// ---------- 混合物の組み立て ----------

export async function buildMixture(
  actor: Actor,
  productId: string,
  country: string,
  asOf: string,
): Promise<{ mixture: Mixture; inputs: JudgementInputs }> {
  const [{ rows, blocked }, product] = await Promise.all([
    collectIngredients(actor, productId),
    prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { properties: { include: { def: true } } },
    }),
  ]);
  const substances = rows.map((r) => ({ id: r.substanceId, casNormalized: r.casNormalized }));
  const [adopted, props] = await Promise.all([
    adoptForSubstances(substances, country, asOf),
    prisma.substanceProperty.findMany({
      where: { substanceId: { in: substances.map((s) => s.id) } },
      include: { def: { select: { key: true } } },
    }),
  ]);

  const snapshots: IngredientSnapshot[] = rows.map((r) => {
    const categories = new Map<string, string>();
    const unknown = new Set<string>();
    const noHazard = new Set<string>();
    const from = new Map<string, string>();
    applyAdoptedCells({ categories, unknown, noHazard, from }, adopted.get(r.substanceId) ?? []);
    const values: Record<string, number> = {};
    const flags: string[] = [];
    for (const p of props.filter((x) => x.substanceId === r.substanceId)) {
      const vk = VALUE_KEYS[p.def.key];
      if (vk && p.valueNum !== null) values[vk] = Number(p.valueNum.toString());
      const fk = FLAG_KEYS[p.def.key];
      if (fk && p.valueText === "yes") flags.push(fk);
    }
    return {
      substanceId: r.substanceId,
      code: r.code,
      nameJa: r.nameJa,
      nameEn: r.nameEn,
      cas: r.cas,
      pct: r.pct.toString(),
      categories: Object.fromEntries(categories),
      unknown: [...unknown],
      noHazard: [...noHazard],
      values,
      flags,
      from: Object.fromEntries(from),
    };
  });

  const productValues: Record<string, number | string> = {};
  for (const p of product.properties) {
    if (!PRODUCT_KEYS.has(p.def.key)) continue;
    if (p.valueNum !== null) productValues[p.def.key] = Number(p.valueNum.toString());
    else if (p.valueText) productValues[p.def.key] = p.valueText;
  }

  return {
    mixture: mixtureFromInputs({ ingredients: snapshots, product: productValues, blocked }),
    inputs: { ingredients: snapshots, product: productValues, blocked },
  };
}

/** 保存した写しから、処理系に渡す形を作る（計算し直すときも同じ） */
export function mixtureFromInputs(inputs: JudgementInputs): Mixture {
  const ingredients: Ingredient[] = inputs.ingredients.map((s) => ({
    name: s.nameJa || s.code,
    cas: s.cas ?? undefined,
    // 処理系は JavaScript の数値で計算する（decimal.js への置き換えは S27 §8-2）
    conc: Number(s.pct),
    categories: new Map(Object.entries(s.categories)),
    values: new Map(Object.entries(s.values)),
    unknown: new Set(s.unknown),
    noHazard: new Set(s.noHazard),
    flags: new Set(s.flags),
  }));
  return { ingredients, product: new Map(Object.entries(inputs.product)) };
}

// ---------- 計算と保存 ----------

export async function computeProductJudgement(
  actor: Actor,
  productId: string,
  country: string,
): Promise<ProductGhsJudgementDto> {
  const top = COUNTRY_RULESETS[country];
  if (!top) throw new Error(`この国のルールセットはまだありません: ${country}`);
  const asOf = todayInJapan();
  const [merged, built] = await Promise.all([
    mergedFor(country),
    buildMixture(actor, productId, country, asOf),
  ]);
  const results = [...merged.rules.keys()].map((cls) =>
    classifyClass(merged, cls, built.mixture, { trace: true }),
  );
  // 開けなかった原材料があれば、全クラスに要判断の印
  if (built.inputs.blocked.length > 0) {
    for (const r of results) r.judgement.push("blocked_materials");
  }
  const computedAt = new Date();
  await prisma.sdsGhsProductJudgement.upsert({
    where: { productId_country: { productId, country } },
    create: {
      productId,
      country,
      rulesetName: top.name,
      rulesetVersion: top.version,
      asOf,
      computedAt,
      computedBy: actor.user.id,
      inputs: built.inputs as object,
      results: results as unknown as object,
    },
    update: {
      rulesetName: top.name,
      rulesetVersion: top.version,
      asOf,
      computedAt,
      computedBy: actor.user.id,
      inputs: built.inputs as object,
      results: results as unknown as object,
    },
  });
  return {
    productId,
    country,
    rulesetName: top.name,
    rulesetVersion: top.version,
    layers: merged.layers,
    asOf,
    computedAt: computedAt.toISOString(),
    computedBy: actor.user.id,
    classLabels: classLabelsOf(merged),
    results,
    inputs: built.inputs,
  };
}

export async function readProductJudgement(
  productId: string,
  country: string,
): Promise<ProductGhsJudgementDto | null> {
  const row = await prisma.sdsGhsProductJudgement.findUnique({
    where: { productId_country: { productId, country } },
  });
  if (!row) return null;
  const merged = await mergedFor(country);
  return {
    productId,
    country,
    rulesetName: row.rulesetName,
    rulesetVersion: row.rulesetVersion,
    layers: merged.layers,
    asOf: row.asOf,
    computedAt: row.computedAt.toISOString(),
    computedBy: row.computedBy,
    classLabels: classLabelsOf(merged),
    results: row.results as unknown as ClassResult[],
    inputs: row.inputs as unknown as JudgementInputs,
  };
}

function classLabelsOf(merged: Merged): Record<string, string> {
  return Object.fromEntries([...merged.classes.values()].map((c) => [c.name, c.label]));
}

/** 組成を見られない人には、成分の名前・含有率・根拠を出さない（結果とクラスの注だけ） */
export function withholdIngredients(dto: ProductGhsJudgementDto): ProductGhsJudgementDto {
  return {
    ...dto,
    results: dto.results.map((r) => ({ ...r, trace: undefined })),
    inputs: { ingredients: [], product: dto.inputs.product, blocked: [] },
  };
}
