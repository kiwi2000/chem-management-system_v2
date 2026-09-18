import {
  effectiveThreshold,
  type ColumnFilter,
  type Messages,
  type OwnThreshold,
  type ThresholdBound,
} from "@chem/shared";
import type { Prisma } from "@prisma/client";
import { jsonError, type Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type {
  LawDto,
  RegulationCategoryDto,
  RegulationClassDto,
  StatutorySubstanceDto,
} from "@/lib/types";

/**
 * 法規制マスタ（法律 → 区分 → 分類 → 法文物質名）を画面へ渡す形に直す。
 *
 * どの段でも「消してよいか」を画面で判断できるよう、配下の件数を数えて返す。
 */

export const LAW_INCLUDE = {
  // 地域は国の1つ上。法律の一覧に出すので、国と一緒に引く
  country: {
    select: {
      nameJa: true,
      nameEn: true,
      region: { select: { id: true, nameJa: true, nameEn: true } },
    },
  },
  _count: { select: { categories: { where: { deletedAt: null } } } },
} satisfies Prisma.LawInclude;

type LawRow = Prisma.LawGetPayload<{ include: typeof LAW_INCLUDE }>;

export function toLawDto(l: LawRow): LawDto {
  return {
    id: l.id,
    code: l.code,
    countryId: l.countryId,
    countryNameJa: l.country.nameJa,
    countryNameEn: l.country.nameEn,
    regionId: l.country.region.id,
    regionNameJa: l.country.region.nameJa,
    regionNameEn: l.country.region.nameEn,
    nameOriginal: l.nameOriginal,
    nameLang: l.nameLang,
    nameJa: l.nameJa,
    nameEn: l.nameEn,
    displayOrder: l.displayOrder,
    note: l.note,
    categoryCount: l._count.categories,
  };
}

/**
 * 区分の配下の法文物質名の数。
 * 分類を1段はさむので Prisma の _count では数えられず、まとめて引いてから配る。
 */
export async function countSubstancesByCategory(
  categoryIds: string[],
): Promise<Map<string, number>> {
  if (categoryIds.length === 0) return new Map();
  const rows = await prisma.regulationClass.findMany({
    where: { categoryId: { in: categoryIds }, deletedAt: null },
    select: {
      categoryId: true,
      _count: { select: { statutorySubstances: { where: { deletedAt: null } } } },
    },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    out.set(r.categoryId, (out.get(r.categoryId) ?? 0) + r._count.statutorySubstances);
  }
  return out;
}

/** 日付だけの列（時刻なし・UTC の 0 時）を YYYY-MM-DD にする */
const toDate = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);

type CategoryRow = Prisma.RegulationCategoryGetPayload<object>;

export function toCategoryDto(c: CategoryRow, substanceCount: number): RegulationCategoryDto {
  return {
    id: c.id,
    code: c.code,
    lawId: c.lawId,
    nameOriginal: c.nameOriginal,
    nameLang: c.nameLang,
    nameJa: c.nameJa,
    nameEn: c.nameEn,
    thresholdLower: c.thresholdLower.toString(),
    lowerBound: c.lowerBound,
    thresholdUpper: c.thresholdUpper.toString(),
    upperBound: c.upperBound,
    interactionGroup: c.interactionGroup,
    rank: c.rank,
    thresholdBasis: c.thresholdBasis,
    judged: c.judged,
    effectiveFrom: toDate(c.effectiveFrom),
    effectiveTo: toDate(c.effectiveTo),
    score: c.score.toString(),
    displayOrder: c.displayOrder,
    note: c.note,
    substanceCount,
  };
}

export const CLASS_INCLUDE = {
  _count: { select: { statutorySubstances: { where: { deletedAt: null } } } },
} satisfies Prisma.RegulationClassInclude;

type ClassRow = Prisma.RegulationClassGetPayload<{ include: typeof CLASS_INCLUDE }>;

export function toClassDto(c: ClassRow): RegulationClassDto {
  return {
    id: c.id,
    code: c.code,
    categoryId: c.categoryId,
    nameOriginal: c.nameOriginal,
    nameLang: c.nameLang,
    nameJa: c.nameJa,
    nameEn: c.nameEn,
    displayOrder: c.displayOrder,
    substanceCount: c._count.statutorySubstances,
  };
}

/** 区分の閾値。法文物質名の空の欄を埋める既定値なので、いつも一緒に引く */
export const CATEGORY_THRESHOLD_SELECT = {
  thresholdLower: true,
  lowerBound: true,
  thresholdUpper: true,
  upperBound: true,
} satisfies Prisma.RegulationCategorySelect;

export const SUBSTANCE_INCLUDE = {
  _count: { select: { links: true } },
  regulationClass: { select: { category: { select: CATEGORY_THRESHOLD_SELECT } } },
} satisfies Prisma.StatutorySubstanceInclude;

type CategoryThresholdRow = {
  thresholdLower: { toString(): string };
  lowerBound: ThresholdBound;
  thresholdUpper: { toString(): string };
  upperBound: ThresholdBound;
};

/** DB の区分の行から、閾値の4欄を文字で取り出す */
export function categoryThresholdOf(c: CategoryThresholdRow) {
  return {
    thresholdLower: c.thresholdLower.toString(),
    lowerBound: c.lowerBound,
    thresholdUpper: c.thresholdUpper.toString(),
    upperBound: c.upperBound,
  };
}

/**
 * 法文物質名の閾値の並び（下限 ≤ 上限）を、空の欄を区分で埋めたうえで見る。
 * 入力の検査（Zod）は両方入っているときしか比べられないので、区分が分かるここで見る。
 * 崩れていれば、画面がそのまま出せる 400 を返す
 */
export function thresholdOrderError(
  own: OwnThreshold,
  category: CategoryThresholdRow,
  m: Messages,
): Response | null {
  const t = effectiveThreshold(own, categoryThresholdOf(category));
  if (Number(t.thresholdLower) <= Number(t.thresholdUpper)) return null;
  return jsonError(400, "validation_error", m.errors.validation, {
    formErrors: [],
    fieldErrors: { thresholdUpper: [m.validation.thresholdOrder] },
  });
}

/**
 * 物質名で当たった法文物質名が、これを超えたら断る。
 *
 * **黙って切り詰めない**（2026-09-18 指摘）。出るはずのものが出ないまま「該当なし」に
 * 見えると、法規制の確認で見落としになる。
 * 数そのものは、PostgreSQL が1つの問い合わせに取れる値の数（**32767**。65535 ではない）に
 * ほかの条件のぶんの余裕を残して決めている。超えると切り詰めではなく問い合わせ自体が失敗する
 */
const NAME_MATCH_MAX = 30000;

/** LIKE の特殊文字（% _ \）を、そのままの文字として扱わせる */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * 名前の欄の条件を LIKE の形にする。使えない条件（空・「空でない」・空文字）なら null
 */
function namePattern(filter: ColumnFilter | undefined): string | null {
  if (!filter || filter.kind !== "text") return null;
  // 「空」「空でない」は物質の側では意味を成さない（リンクの有無は CAS番号の欄で見る）
  if (filter.op === "empty" || filter.op === "notEmpty") return null;
  const value = filter.value.trim();
  if (value === "") return null;

  const lit = likeLiteral(value);
  return filter.op === "startsWith"
    ? `${lit}%`
    : filter.op === "endsWith"
      ? `%${lit}`
      : filter.op === "equals"
        ? lit
        : `%${lit}%`;
}

/**
 * 登録してある物質の名前から、**区分**を絞る（2026-09-18 指示。法律の一覧で使う）。
 *
 * 結び付き → 法文物質名 → 分類 → 区分 とたどって、区分の id を返す。
 * 区分は多くても百件ほどなので、法文物質名のときのような上限は要らない。
 * 条件が無ければ null（＝絞らない）。版が決まっていなければ空（＝1件も当たらない）
 */
export async function linkedSubstanceNameCategoryIds(
  actor: Actor,
  filter: ColumnFilter | undefined,
  versionId: string | null,
): Promise<string[] | null> {
  const pattern = namePattern(filter);
  if (pattern === null) return null;
  if (versionId === null) return [];
  const seeAll = actor.has("INACTIVE_VIEW");

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT rc.category_id AS id
    FROM statutory_cas_links l
    JOIN statutory_substances ss
      ON ss.id = l.statutory_substance_id AND ss.deleted_at IS NULL
    JOIN regulation_classes rc
      ON rc.id = ss.class_id AND rc.deleted_at IS NULL
    JOIN substances s
      ON s.cas_normalized = l.cas_normalized AND s.deleted_at IS NULL
    LEFT JOIN substance_aliases a ON a.substance_id = s.id
    WHERE l.version_id = ${versionId}::text
      AND (${seeAll} OR s.publish_state = 'PUBLISHED' OR s.created_by = ${actor.user.id}::text)
      AND (
        LOWER(s.name_ja) LIKE LOWER(${pattern})
        OR LOWER(s.name_en) LIKE LOWER(${pattern})
        OR LOWER(a.name_ja) LIKE LOWER(${pattern})
        OR LOWER(a.name_en) LIKE LOWER(${pattern})
      )
  `;
  return rows.map((r) => r.id);
}

/**
 * 登録してある物質の名前から、法文物質名を絞る条件（2026-09-18 指示）。
 *
 * **物質の表と法文物質名の表はつながっていない。**突き合わせは CAS番号で行う。
 * Prisma は一意でない列（`cas_normalized`）での関連を張れないので、
 * **当たる CAS を全部持ってくるのではなく、条件のまま DB に渡して結合させる**（同日 指摘）。
 * 別名も見る（物質の一覧の「別名も含む」と同じ）。
 *
 * **見えない物質は当てない。**未公開の物質の名前で当たってしまうと、
 * その物質があること自体が伝わる（CLAUDE.md §4）。
 * 区分（分類）で絞っているときは、その中だけを見る
 */
export async function linkedSubstanceNameWhere(
  actor: Actor,
  filter: ColumnFilter | undefined,
  classIds: string[],
  /** いま判定に使っている版。結び付きはこの版のものだけを見る（2026-09-18 指摘） */
  versionId: string | null,
  m: Messages,
): Promise<Prisma.StatutorySubstanceWhereInput | Response | null> {
  const pattern = namePattern(filter);
  if (pattern === null) return null;
  const seeAll = actor.has("INACTIVE_VIEW");
  const anyClass = classIds.length === 0;
  // 版が決まっていないときは、当たるものが無い（判定も動いていない状態）
  if (versionId === null) return { id: { in: [] } };

  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT l.statutory_substance_id AS id
    FROM statutory_cas_links l
    JOIN statutory_substances ss
      ON ss.id = l.statutory_substance_id AND ss.deleted_at IS NULL
    JOIN substances s
      ON s.cas_normalized = l.cas_normalized AND s.deleted_at IS NULL
    LEFT JOIN substance_aliases a ON a.substance_id = s.id
    WHERE l.version_id = ${versionId}::text
      AND (${anyClass} OR ss.class_id = ANY(${classIds}::text[]))
      AND (${seeAll} OR s.publish_state = 'PUBLISHED' OR s.created_by = ${actor.user.id}::text)
      AND (
        LOWER(s.name_ja) LIKE LOWER(${pattern})
        OR LOWER(s.name_en) LIKE LOWER(${pattern})
        OR LOWER(a.name_ja) LIKE LOWER(${pattern})
        OR LOWER(a.name_en) LIKE LOWER(${pattern})
      )
    LIMIT ${NAME_MATCH_MAX + 1}
  `;
  if (rows.length > NAME_MATCH_MAX) {
    return jsonError(400, "too_many_matches", m.statutorySubstances.substanceNameTooMany);
  }
  // 1件も当たらなければ、結果も1件も出さない（条件を無視して全件出さない）
  return { id: { in: rows.map((r) => r.id) } };
}

type SubstanceRow = Prisma.StatutorySubstanceGetPayload<{ include: typeof SUBSTANCE_INCLUDE }>;

/** 日付は日だけ使うので、時刻を持たない形（YYYY-MM-DD）で渡す */

export function toStatutorySubstanceDto(s: SubstanceRow): StatutorySubstanceDto {
  return {
    id: s.id,
    code: s.code,
    classId: s.classId,
    officialNumber: s.officialNumber,
    nameOriginal: s.nameOriginal,
    nameLang: s.nameLang,
    nameJa: s.nameJa,
    nameEn: s.nameEn,
    thresholdLower: s.thresholdLower?.toString() ?? null,
    lowerBound: s.lowerBound,
    thresholdUpper: s.thresholdUpper?.toString() ?? null,
    upperBound: s.upperBound,
    categoryThreshold: categoryThresholdOf(s.regulationClass.category),
    effectiveFrom: toDate(s.effectiveFrom),
    effectiveTo: toDate(s.effectiveTo),
    displayOrder: s.displayOrder,
    applicableCondition: s.applicableCondition,
    note: s.note,
    casCount: s._count.links,
  };
}

/**
 * 区分は、名前のない分類を必ず1件持つ。
 * 法文物質名の親を常に分類にしておくと外部キーが1本で済み、
 * 後から分けたくなっても既存のぶら下がりを動かさずに名前を付けるだけで足りる。
 */
export async function ensureDefaultClass(categoryId: string, actorId: string): Promise<void> {
  const count = await prisma.regulationClass.count({ where: { categoryId, deletedAt: null } });
  if (count > 0) return;
  await prisma.regulationClass.create({
    data: {
      categoryId,
      code: "DEFAULT",
      codeNormalized: "DEFAULT",
      nameOriginal: null,
      nameLang: null,
      displayOrder: 0,
      createdBy: actorId,
      updatedBy: actorId,
    },
  });
}
