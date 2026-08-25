import { prisma } from "@/lib/db";

/**
 * データの整合性チェック（FR-AU-03）。
 *
 * 判定は、足りないデータがあっても**止まらない**ように作ってある
 * （寄与 0 として数え、要確認の印を立てる）。法律が先に決まって係数が後から入る、
 * という順番が実際にあるため。
 *
 * ただし**足りないままでよいわけではない。**
 * 放っておくと「換算したつもりで換算していない」判定が積み上がる。
 * ここで欠陥として拾い、直す先を指し示す。
 */

/** 見つかった欠陥の種類 */
export type IntegrityKind =
  /**
   * 金属等が決まっている法文物質名に CAS が紐づいているのに、
   * その組み合わせの換算係数が無い。
   * **判定がその CAS を 0 として数えるので、実際より少なく出る**
   */
  | "missingConversionFactor"
  /** 金属等が決まっているのに、金属等の記号が元素マスタに無い */
  | "unknownConversionTarget";

export interface IntegrityIssue {
  kind: IntegrityKind;
  /** 直す対象。CAS や記号など */
  key: string;
  /** どこで困っているか（法文物質名の名前）。多いものから3件まで */
  where: string[];
  /** 同じ鍵で何件あるか */
  count: number;
}

export interface IntegrityReport {
  /** どの版について調べたか */
  versionCode: string;
  checkedAt: string;
  issues: IntegrityIssue[];
  /** 種類ごとの件数 */
  totals: Record<IntegrityKind, number>;
}

/**
 * いまの版について調べる。
 *
 * **「金属等つき × CASリンクあり」なら、換算係数は必ず要る。**
 * 無いものは欠陥として全部挙げる。
 */
export async function checkIntegrity(): Promise<IntegrityReport | null> {
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true, code: true },
  });
  if (!version) return null;

  const entries = await prisma.statutorySubstance.findMany({
    where: { aggregation: "ELEMENT", metalEtc: { not: null }, deletedAt: null },
    select: { id: true, nameJa: true, nameOriginal: true, metalEtc: true },
  });
  if (entries.length === 0) {
    return {
      versionCode: version.code,
      checkedAt: new Date().toISOString(),
      issues: [],
      totals: { missingConversionFactor: 0, unknownConversionTarget: 0 },
    };
  }

  const links = await prisma.statutoryCasLink.findMany({
    where: {
      versionId: version.id,
      excluded: false,
      statutorySubstanceId: { in: entries.map((e) => e.id) },
    },
    select: { statutorySubstanceId: true, casNormalized: true },
  });

  const factors = await prisma.metalConversionFactor.findMany({
    where: { deletedAt: null },
    select: { casNormalized: true, metalElement: true },
  });
  const have = new Set(factors.map((f) => `${f.casNormalized}|${f.metalElement}`));

  const symbols = new Set(
    (await prisma.element.findMany({ where: { deletedAt: null }, select: { symbol: true } })).map(
      (e) => e.symbol,
    ),
  );

  const infoOf = new Map(entries.map((e) => [e.id, e]));
  /** 鍵（CAS|金属等） → どの法文物質名で困っているか */
  const missing = new Map<string, Set<string>>();
  const unknownTarget = new Map<string, Set<string>>();

  for (const e of entries) {
    const target = e.metalEtc as string;
    if (!symbols.has(target)) {
      const set = unknownTarget.get(target) ?? new Set<string>();
      set.add(e.nameJa ?? e.nameOriginal);
      unknownTarget.set(target, set);
    }
  }

  for (const l of links) {
    const e = infoOf.get(l.statutorySubstanceId);
    if (!e) continue;
    const key = `${l.casNormalized}|${e.metalEtc}`;
    if (have.has(key)) continue;
    const set = missing.get(key) ?? new Set<string>();
    set.add(e.nameJa ?? e.nameOriginal);
    missing.set(key, set);
  }

  const toIssues = (m: Map<string, Set<string>>, kind: IntegrityKind): IntegrityIssue[] =>
    [...m.entries()]
      .map(([key, where]) => ({ kind, key, where: [...where].slice(0, 3), count: where.size }))
      // 影響の大きいものから直せるように、関わる法文物質名の多い順
      .sort((a, b) => b.count - a.count);

  const issues = [
    ...toIssues(unknownTarget, "unknownConversionTarget"),
    ...toIssues(missing, "missingConversionFactor"),
  ];

  return {
    versionCode: version.code,
    checkedAt: new Date().toISOString(),
    issues,
    totals: {
      missingConversionFactor: missing.size,
      unknownConversionTarget: unknownTarget.size,
    },
  };
}
