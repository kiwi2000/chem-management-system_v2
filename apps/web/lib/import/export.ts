import {
  DATA_SET_FORMAT,
  PRODUCTS_COLUMNS,
  REGULATION_LIST_COLUMNS,
  SUBSTANCES_COLUMNS,
  normalizeCode,
  writeTable,
  type Snapshot,
} from "@chem/shared";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { takeSnapshot } from "@/lib/import/snapshot";
import { visibilityWhere } from "@/lib/product-service";

/**
 * 「エクスポート」（決定 0011）。書き出したファイルは、そのまま「インポート」で読める形にする。
 *
 *   - 規制リスト（TSV）… 1 行 = 法文物質名 × CAS。現在のバージョンの結び付きだけ。
 *                        コードの列も入れるので、名前を直して読み戻しても同じものとして更新できる
 *   - 製品と組成（TSV）… 見られる製品だけ。組成は「非公開の組成も見られる」人だけ
 *   - 物質（TSV）
 *   - データセット（JSON）… 法規制データの写しそのもの（format = chem-data-set/1）。
 *                        データソースで絞れる（契約していないソースの結び付きを渡さないため）
 *
 * 列名は各定義の names[0]（日本語）で出す
 */

const head = (columns: readonly { names: readonly string[] }[]) => columns.map((c) => c.names[0]!);

export interface RegulationListFilter {
  /** 法律コード。省くと全部 */
  lawCode?: string;
  /** データソースのコード。省くと全部 */
  sourceCode?: string;
}

/** 規制リスト（現在のバージョン）。行の順は 法律 → 区分 → 分類 → 法文物質名 → CAS */
export async function exportRegulationList(filter: RegulationListFilter): Promise<string> {
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true, deletedAt: null },
    select: { id: true },
  });
  const source = filter.sourceCode
    ? await prisma.source.findUnique({
        where: { codeNormalized: normalizeCode(filter.sourceCode) },
        select: { id: true },
      })
    : null;
  const rows: (string | null)[][] = [];
  if (!version || (filter.sourceCode && !source))
    return writeTable(head(REGULATION_LIST_COLUMNS), rows);

  const laws = await prisma.law.findMany({
    where: {
      deletedAt: null,
      ...(filter.lawCode ? { codeNormalized: normalizeCode(filter.lawCode) } : {}),
    },
    orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      nameJa: true,
      nameOriginal: true,
      country: { select: { code: true } },
    },
  });
  for (const law of laws) {
    const categories = await prisma.regulationCategory.findMany({
      where: { lawId: law.id, deletedAt: null },
      orderBy: { displayOrder: "asc" },
      select: {
        code: true,
        nameJa: true,
        nameOriginal: true,
        classes: {
          where: { deletedAt: null },
          orderBy: { displayOrder: "asc" },
          select: {
            code: true,
            nameJa: true,
            nameOriginal: true,
            statutorySubstances: {
              where: { deletedAt: null },
              orderBy: { displayOrder: "asc" },
              select: {
                id: true,
                code: true,
                officialNumber: true,
                nameJa: true,
                nameOriginal: true,
                thresholdLower: true,
                lowerBound: true,
                thresholdUpper: true,
                upperBound: true,
                applicableCondition: true,
                note: true,
              },
            },
          },
        },
      },
    });
    // 結び付きは法律ごとにまとめて読む（法文物質名ごとに聞くと往復が多すぎる）
    const links = await prisma.statutoryCasLink.findMany({
      where: {
        versionId: version.id,
        ...(source ? { sourceId: source.id } : {}),
        statutorySubstance: { regulationClass: { category: { lawId: law.id } } },
      },
      select: {
        statutorySubstanceId: true,
        casNumber: true,
        casNormalized: true,
        excluded: true,
        note: true,
      },
    });
    const linksOf = new Map<string, typeof links>();
    for (const l of links) {
      const list = linksOf.get(l.statutorySubstanceId) ?? [];
      list.push(l);
      linksOf.set(l.statutorySubstanceId, list);
    }
    for (const cat of categories) {
      for (const cls of cat.classes) {
        for (const sub of cls.statutorySubstances) {
          const own = (linksOf.get(sub.id) ?? []).sort((a, b) =>
            a.casNormalized.localeCompare(b.casNormalized),
          );
          for (const l of own) {
            rows.push([
              law.code,
              law.nameJa ?? law.nameOriginal,
              law.country.code,
              cat.code,
              cat.nameJa ?? cat.nameOriginal,
              cls.code,
              cls.nameJa ?? cls.nameOriginal ?? "",
              sub.officialNumber,
              sub.code,
              sub.nameJa ?? sub.nameOriginal,
              l.casNumber,
              sub.thresholdLower.toString(),
              sub.lowerBound,
              sub.thresholdUpper.toString(),
              sub.upperBound,
              sub.applicableCondition,
              l.excluded ? "1" : "",
              [sub.note, l.note].filter(Boolean).join(" / ") || null,
            ]);
          }
        }
      }
    }
  }
  return writeTable(head(REGULATION_LIST_COLUMNS), rows);
}

/**
 * 製品と組成。見られる製品だけ（visibilityWhere）。
 * 組成は「非公開の組成も見られる」人にだけ出す。無い人には製品の行だけ
 */
export async function exportProducts(actor: Actor): Promise<string> {
  const withComposition = actor.has("COMPOSITION_VIEW");
  const products = await prisma.product.findMany({
    where: { deletedAt: null, ...visibilityWhere(actor) },
    orderBy: { codeNormalized: "asc" },
    select: {
      code: true,
      nameJa: true,
      nameEn: true,
      modelValue: true,
      usableAsMaterial: true,
      status: true,
      note: true,
      uses: { orderBy: { displayOrder: "asc" }, select: { value: true } },
      // 組成は読んでおいて、権限が無ければ書き出さない（サーバーの外には出ない）
      compositionLines: {
        orderBy: { displayOrder: "asc" },
        select: {
          contentPct: true,
          note: true,
          substance: { select: { code: true, casNumber: true } },
          childProduct: { select: { code: true } },
        },
      },
    },
  });
  const rows: (string | null)[][] = [];
  for (const p of products) {
    const base = [
      p.code,
      p.nameJa,
      p.nameEn,
      p.modelValue,
      p.uses.map((u) => u.value).join("; "),
      p.usableAsMaterial ? "1" : "",
      p.status === "DISCONTINUED" ? "生産終了" : "有効",
      p.note,
    ];
    const lines = withComposition ? p.compositionLines : [];
    if (lines.length === 0) {
      rows.push([...base, null, null, null, null, null]);
      continue;
    }
    for (const l of lines) {
      rows.push([
        ...base,
        l.substance?.casNumber ?? null,
        l.substance?.code ?? null,
        l.childProduct?.code ?? null,
        l.contentPct?.toString() ?? null,
        l.note,
      ]);
    }
  }
  return writeTable(head(PRODUCTS_COLUMNS), rows);
}

/** 物質。別名は「;」区切りで 1 列 */
export async function exportSubstances(): Promise<string> {
  const substances = await prisma.substance.findMany({
    where: { deletedAt: null },
    orderBy: { codeNormalized: "asc" },
    select: { id: true, code: true, nameJa: true, nameEn: true, casNumber: true, note: true },
  });
  // 別名は別に読む（物質の select の中で並べ替えると Prisma の照会エンジンが落ちる。2026-09-15 に実際に起きた）
  const aliases = await prisma.substanceAlias.findMany({
    where: { nameJa: { not: null } },
    orderBy: [{ substanceId: "asc" }, { displayOrder: "asc" }],
    select: { substanceId: true, nameJa: true },
  });
  const aliasesOf = new Map<string, string[]>();
  for (const a of aliases) {
    const list = aliasesOf.get(a.substanceId) ?? [];
    list.push(a.nameJa!);
    aliasesOf.set(a.substanceId, list);
  }
  return writeTable(
    head(SUBSTANCES_COLUMNS),
    substances.map((s) => [
      s.code,
      s.nameJa,
      s.nameEn,
      s.casNumber,
      (aliasesOf.get(s.id) ?? []).join("; "),
      s.note,
    ]),
  );
}

/**
 * データセット（JSON）。法規制データの写し。
 * データソースのコードを渡すと、その結び付きだけにする（他のソースの結び付きは落とす）
 */
export async function exportDataSet(label: string, sourceCodes?: string[]): Promise<Snapshot> {
  const snap = await takeSnapshot(prisma, label, DATA_SET_FORMAT);
  if (!sourceCodes || sourceCodes.length === 0) return snap;
  const keep = new Set(sourceCodes.map(normalizeCode));
  snap.sources = snap.sources.filter((s) => keep.has(normalizeCode(s.code)));
  for (const law of snap.laws)
    for (const cat of law.categories)
      for (const cls of cat.classes)
        for (const sub of cls.substances)
          sub.links = sub.links.filter((l) => keep.has(normalizeCode(l.source)));
  return snap;
}
