import {
  looksLikeCas,
  normalizeCas,
  normalizeCode,
  type AppSettings,
  type Messages,
  type SubstanceInput,
} from "@chem/shared";
import type { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { propertyWrites } from "@/lib/property-values";
import type { SubstanceDetailDto, SubstanceListItemDto } from "@/lib/types";

/** 一覧に必要な関連（別名は件数だけ使う） */
export const SUBSTANCE_LIST_INCLUDE = {
  _count: { select: { aliases: true } },
  gazetteNumbers: { orderBy: { displayOrder: "asc" } },
} satisfies Prisma.SubstanceInclude;

/** 詳細取得で必要になる関連 */
export const SUBSTANCE_INCLUDE = {
  _count: { select: { aliases: true } },
  aliases: { orderBy: { displayOrder: "asc" } },
  gazetteNumbers: { orderBy: { displayOrder: "asc" } },
  properties: { include: { def: true } },
} satisfies Prisma.SubstanceInclude;

type SubstanceListRow = Prisma.SubstanceGetPayload<{ include: typeof SUBSTANCE_LIST_INCLUDE }>;
type SubstanceWithRelations = Prisma.SubstanceGetPayload<{ include: typeof SUBSTANCE_INCLUDE }>;

/**
 * 一覧・詳細に出してよい物質の条件。
 *
 * 物質は「無効」でも隠さない（組成に使われているものが読めなくなるため）。
 * 隠すのはドラフトのものだけで、作成者と `INACTIVE_VIEW` を持つ人にだけ見せる。
 */
export function visibilityWhere(actor: Actor): Prisma.SubstanceWhereInput {
  if (actor.has("INACTIVE_VIEW")) return {};
  return { OR: [{ draftFlag: false }, { createdBy: actor.user.id }] };
}

/** 書き換えてよいか。ドラフトのものは専用の権限か、作成者本人だけ */
export function canEditSubstance(
  actor: Actor,
  target: { draftFlag: boolean; createdBy: string | null },
): boolean {
  if (!actor.has("SUBSTANCE_EDIT")) return false;
  if (!target.draftFlag) return true;
  return actor.has("INACTIVE_EDIT") || target.createdBy === actor.user.id;
}

export function toListItem(s: SubstanceListRow): SubstanceListItemDto {
  return {
    id: s.id,
    code: s.code,
    casNumber: s.casNumber,
    status: s.status,
    draftFlag: s.draftFlag,
    nameJa: s.nameJa,
    nameEn: s.nameEn,
    note: s.note,
    aliasCount: s._count.aliases,
    gazetteNumbers: s.gazetteNumbers.map((g) => ({ lawKind: g.lawKind, number: g.number })),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toDetail(s: SubstanceWithRelations): SubstanceDetailDto {
  return {
    ...toListItem(s),
    mainNameJa: s.nameJa,
    mainNameEn: s.nameEn,
    subNames: s.aliases.map((n) => ({ nameJa: n.nameJa, nameEn: n.nameEn })),
    properties: s.properties.map((p) => ({
      propertyDefId: p.propertyDefId,
      valueText: p.valueText,
      valueNum: p.valueNum?.toString() ?? null,
      unit: p.unit,
    })),
  };
}

/**
 * CAS欄の扱いはシステム設定で切り替える。
 * 厳しくしている場合はここで止め、そうでなければ警告に落とす。
 */
export function validateCas(
  casNormalized: string | null,
  settings: AppSettings,
  m: Messages,
): string | null {
  if (!casNormalized) {
    return settings.casRequired ? m.errors.casRequired : null;
  }
  if (settings.casFormatEnforced && !looksLikeCas(casNormalized)) {
    return m.errors.casFormatInvalid;
  }
  return null;
}

/** 保存はできるが利用者に伝えたいこと */
export async function collectWarnings(
  casNormalized: string | null,
  excludeSubstanceId: string | null,
  settings: AppSettings,
  m: Messages,
): Promise<string[]> {
  const warnings: string[] = [];
  if (!casNormalized) return warnings;

  // 形式を強制している場合は validateCas がエラーで弾くので、ここでは警告を出さない
  if (!settings.casFormatEnforced && !looksLikeCas(casNormalized)) {
    warnings.push(m.substances.warnCasFormat);
  }

  // 同一CASは意図的に許しているが、取り違えに気づけるよう知らせる
  const same = await prisma.substance.findMany({
    where: {
      casNormalized,
      deletedAt: null,
      ...(excludeSubstanceId ? { id: { not: excludeSubstanceId } } : {}),
    },
    select: { code: true },
    take: 10,
  });
  if (same.length > 0) warnings.push(m.substances.warnSameCas(same.map((s) => s.code).join(", ")));

  return warnings;
}

/**
 * 入力から DB に書く値へ。正規化はここに集約する。
 * コードはユーザーが決める業務キーなので原文（大小文字）を残すが、
 * CAS番号は表記が一つに決まる識別子なので、表示用の値も正規化後に揃える
 * （全角で入力されたものが一覧にそのまま並ぶと読みにくいため）。
 */
export function normalizeInput(input: SubstanceInput) {
  const casNormalized = input.casNumber?.trim() ? normalizeCas(input.casNumber) : null;
  return {
    code: input.code.trim(),
    codeNormalized: normalizeCode(input.code),
    casNumber: casNormalized,
    casNormalized,
    status: input.status,
    note: input.note?.trim() || null,
    nameJa: input.mainNameJa.trim(),
    nameEn: input.mainNameEn?.trim() || null,
  };
}

/** 別名・整理番号・拡張属性は入れ替え方式（差分を追うより単純で事故が少ない） */
export function childWrites(input: SubstanceInput) {
  return {
    aliases: input.subNames.map((n, i) => ({
      nameJa: n.nameJa?.trim() || null,
      nameEn: n.nameEn?.trim() || null,
      displayOrder: i + 1,
    })),
    gazetteNumbers: input.gazetteNumbers.map((g, i) => ({
      lawKind: g.lawKind,
      number: g.number.trim(),
      displayOrder: i + 1,
    })),
    properties: propertyWrites(input.properties),
  };
}

/** 同一物質・同一区分の整理番号が重複していないか */
export function hasDuplicateGazette(input: SubstanceInput): boolean {
  const seen = new Set<string>();
  for (const g of input.gazetteNumbers) {
    const key = `${g.lawKind}:${normalizeCode(g.number)}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
