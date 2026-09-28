import type { SdsGhsClassStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { GHS_CATALOG } from "./catalog-data";
import { SOURCES } from "./import-service";

/**
 * 国ごとの出典の採用（S23 §5-3）。**単位は物質 × 危険有害性クラス。**
 *
 * 1. 物質ごとの上書き（自社判定）があれば、そのクラスはそれで確定
 * 2. 国の採用順に出典を見て、そのクラスを**評価している**最初の出典を採る
 *    （該当・該当しない・対象外は評価済み。「分類できない」は規則で「次で埋める」なら次へ）
 * 3. どの出典にも無ければ「データなし」
 *
 * 主の出典の評価は下位で上書きしない（下位で埋めるのは主が見ていない項目だけ）。
 * 版・ブロックの読み替えは段 1 の後半で足す（いまは出典の区分をそのまま）
 */

export interface AdoptionRule {
  sourceCode: string;
  priority: number;
  fillCannotClassify: boolean;
}

/** 国の採用順。設定が無ければ既定（その国の出典を先頭に、あとは出典の並び順） */
export async function rulesFor(country: string): Promise<AdoptionRule[]> {
  const rows = await prisma.sdsGhsAdoptionRule.findMany({
    where: { country },
    orderBy: { priority: "asc" },
  });
  if (rows.length > 0) return rows;
  return defaultRules(country);
}

export function defaultRules(country: string): AdoptionRule[] {
  const own = SOURCES.filter((s) => s.country === country);
  const rest = SOURCES.filter((s) => s.country !== country).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  return [...own, ...rest].map((s, i) => ({
    sourceCode: s.code,
    priority: i + 1,
    fillCannotClassify: false,
  }));
}

export interface AdoptedCell {
  hazardClass: string;
  status: SdsGhsClassStatus;
  /** 該当のときの区分（複数あり得る）。区分ごとに標的臓器・H を添える */
  items: { category: string; targetOrgans: string | null; hCodes: string | null }[];
  /** どこから来たか: 上書き（OVERRIDE）か出典のコード。データなしなら null */
  from: string | null;
  /** 上書きの理由（上書きのときだけ） */
  reason?: string;
}

interface SourceRow {
  sourceCode: string;
  hazardClass: string;
  category: string;
  status: SdsGhsClassStatus;
  targetOrgans: string | null;
  hCodes: string | null;
}

interface OverrideRow {
  hazardClass: string;
  category: string;
  status: SdsGhsClassStatus;
  targetOrgans: string | null;
  hCodes: string | null;
  country: string;
  reason: string;
}

/** 1 物質ぶんを組み立てる。rows は出典の分類（いま効いている項目のもの）、overrides はその物質の上書き */
export function adoptFor(
  rules: AdoptionRule[],
  rows: SourceRow[],
  overrides: OverrideRow[],
  country: string,
): AdoptedCell[] {
  const out: AdoptedCell[] = [];
  for (const cls of GHS_CATALOG) {
    // 1. 上書き（国指定のものを優先、次に全部の国のもの）
    const ov = overrides.filter(
      (o) => o.hazardClass === cls.code && (o.country === country || o.country === ""),
    );
    const chosenOv = ov.some((o) => o.country === country)
      ? ov.filter((o) => o.country === country)
      : ov;
    if (chosenOv.length > 0) {
      const classified = chosenOv.filter((o) => o.status === "CLASSIFIED");
      out.push({
        hazardClass: cls.code,
        status: classified.length > 0 ? "CLASSIFIED" : chosenOv[0]!.status,
        items: classified.map((o) => ({
          category: o.category,
          targetOrgans: o.targetOrgans,
          hCodes: o.hCodes,
        })),
        from: "OVERRIDE",
        reason: chosenOv[0]!.reason,
      });
      continue;
    }
    // 2. 採用順に出典を見る
    let cell: AdoptedCell | null = null;
    for (const rule of rules) {
      const mine = rows.filter(
        (r) => r.sourceCode === rule.sourceCode && r.hazardClass === cls.code,
      );
      if (mine.length === 0) continue; // その出典はこの項目を見ていない → 次へ
      const classified = mine.filter((r) => r.status === "CLASSIFIED");
      const status: SdsGhsClassStatus = classified.length > 0 ? "CLASSIFIED" : mine[0]!.status;
      if (status === "CANNOT_CLASSIFY" && rule.fillCannotClassify) {
        cell ??= { hazardClass: cls.code, status, items: [], from: rule.sourceCode };
        continue; // 分類できない → 次の出典で埋められれば埋める（埋まらなければこれを残す）
      }
      cell = {
        hazardClass: cls.code,
        status,
        items: classified.map((r) => ({
          category: r.category,
          targetOrgans: r.targetOrgans,
          hCodes: r.hCodes,
        })),
        from: rule.sourceCode,
      };
      break;
    }
    out.push(cell ?? { hazardClass: cls.code, status: "NOT_EVALUATED", items: [], from: null });
  }
  return out;
}

/**
 * 複数の物質ぶんをまとめて引く（一覧用）。CAS で出典の項目（いま効いているもの）を集め、
 * 物質 ID で上書きを集めて、物質ごとに組み立てる
 */
export async function adoptForSubstances(
  substances: { id: string; casNormalized: string | null }[],
  country: string,
  asOf: string,
): Promise<Map<string, AdoptedCell[]>> {
  const rules = await rulesFor(country);
  const day = new Date(`${asOf}T00:00:00Z`);
  const casList = [
    ...new Set(substances.map((s) => s.casNormalized).filter((c): c is string => !!c)),
  ];
  const links = casList.length
    ? await prisma.sdsGhsEntryCas.findMany({
        where: {
          casNormalized: { in: casList },
          entry: {
            effectiveFrom: { lte: day },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
          },
        },
        select: {
          casNormalized: true,
          entry: {
            select: {
              sourceKey: true,
              subKey: true,
              source: { select: { code: true } },
              classifications: {
                select: {
                  hazardClass: true,
                  category: true,
                  status: true,
                  targetOrgans: true,
                  hCodes: true,
                },
              },
            },
          },
        },
      })
    : [];
  // 同じ出典に複数の項目（形態違い・濃度条件）があるときは、識別子の若いもの 1 つを使う（S23 の当面の扱い）
  const byCas = new Map<string, SourceRow[]>();
  const seen = new Set<string>();
  for (const l of links.sort((a, b) =>
    (a.entry.sourceKey + a.entry.subKey).localeCompare(b.entry.sourceKey + b.entry.subKey),
  )) {
    const k = `${l.casNormalized}|${l.entry.source.code}`;
    if (seen.has(k)) continue;
    seen.add(k);
    let list = byCas.get(l.casNormalized);
    if (!list) byCas.set(l.casNormalized, (list = []));
    for (const c of l.entry.classifications) list.push({ sourceCode: l.entry.source.code, ...c });
  }
  const overrides = await prisma.sdsGhsOverride.findMany({
    where: { substanceId: { in: substances.map((s) => s.id) }, OR: [{ country }, { country: "" }] },
    select: {
      substanceId: true,
      hazardClass: true,
      category: true,
      status: true,
      targetOrgans: true,
      hCodes: true,
      country: true,
      reason: true,
    },
  });
  const out = new Map<string, AdoptedCell[]>();
  for (const s of substances) {
    const rows = s.casNormalized ? (byCas.get(s.casNormalized) ?? []) : [];
    const ov = overrides.filter((o) => o.substanceId === s.id);
    out.set(s.id, adoptFor(rules, rows, ov, country));
  }
  return out;
}
