import {
  looksLikeCas,
  normalizeCas,
  normalizeCode,
  type Messages,
  type SubstanceInput,
} from "@chem/shared";
import type { Prisma, SubstancePropertyDef } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SubstanceDetailDto, SubstanceListItemDto } from "@/lib/types";

/** 詳細取得で必要になる関連（一覧では names のみ使う） */
export const SUBSTANCE_INCLUDE = {
  names: { orderBy: [{ nameType: "asc" }, { displayOrder: "asc" }] },
  gazetteNumbers: { orderBy: { displayOrder: "asc" } },
  properties: { include: { def: true } },
} satisfies Prisma.SubstanceInclude;

type SubstanceWithRelations = Prisma.SubstanceGetPayload<{ include: typeof SUBSTANCE_INCLUDE }>;

function mainNameOf(s: SubstanceWithRelations) {
  return s.names.find((n) => n.nameType === "MAIN");
}

export function toListItem(s: SubstanceWithRelations): SubstanceListItemDto {
  const main = mainNameOf(s);
  return {
    id: s.id,
    code: s.code,
    casNumber: s.casNumber,
    status: s.status,
    nameJa: main?.nameJa ?? "",
    nameEn: main?.nameEn ?? null,
    subNameCount: s.names.filter((n) => n.nameType === "SUB").length,
  };
}

export function toDetail(s: SubstanceWithRelations): SubstanceDetailDto {
  const main = mainNameOf(s);
  return {
    ...toListItem(s),
    note: s.note,
    mainNameJa: main?.nameJa ?? "",
    mainNameEn: main?.nameEn ?? null,
    subNames: s.names
      .filter((n) => n.nameType === "SUB")
      .map((n) => ({ nameJa: n.nameJa, nameEn: n.nameEn })),
    gazetteNumbers: s.gazetteNumbers.map((g) => ({ lawKind: g.lawKind, number: g.number })),
    properties: s.properties.map((p) => ({
      propertyDefId: p.propertyDefId,
      valueText: p.valueText,
      valueNum: p.valueNum?.toString() ?? null,
      unit: p.unit,
    })),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * 保存前の検証のうち、辞書やDBを見ないと判定できないもの。
 * 返り値が空でなければ 400 で止める。
 */
export function validateProperties(
  input: SubstanceInput,
  defs: SubstancePropertyDef[],
  m: Messages,
): string[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const errors: string[] = [];
  for (const p of input.properties) {
    const def = byId.get(p.propertyDefId);
    if (!def) {
      errors.push(m.errors.unknownProperty);
      continue;
    }
    const hasNum = p.valueNum !== null && p.valueNum !== undefined;
    const hasText = p.valueText !== null && p.valueText !== undefined;
    // 定義の種類と入っている値が食い違っていないか（DBのCHECK制約は「片方だけ」までしか見られない）
    const ok = def.dataType === "NUMBER" ? hasNum && !hasText : hasText && !hasNum;
    if (!ok) errors.push(m.errors.propertyTypeMismatch(def.labelJa));
  }
  return errors;
}

/** 保存はできるが利用者に伝えたいこと */
export async function collectWarnings(
  casNormalized: string | null,
  excludeSubstanceId: string | null,
  m: Messages,
): Promise<string[]> {
  const warnings: string[] = [];
  if (!casNormalized) return warnings;

  if (!looksLikeCas(casNormalized)) warnings.push(m.substances.warnCasFormat);

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
  };
}

/** 名称・整理番号・拡張属性は入れ替え方式（差分を追うより単純で事故が少ない） */
export function childWrites(input: SubstanceInput) {
  return {
    names: [
      {
        nameType: "MAIN" as const,
        nameJa: input.mainNameJa.trim(),
        nameEn: input.mainNameEn?.trim() || null,
        displayOrder: null,
      },
      ...input.subNames.map((n, i) => ({
        nameType: "SUB" as const,
        nameJa: n.nameJa.trim(),
        nameEn: n.nameEn?.trim() || null,
        displayOrder: i + 1,
      })),
    ],
    gazetteNumbers: input.gazetteNumbers.map((g, i) => ({
      lawKind: g.lawKind,
      number: g.number.trim(),
      displayOrder: i + 1,
    })),
    properties: input.properties
      // 値が空の行は保存しない（画面上は全項目の欄が並ぶため）
      .filter((p) => p.valueNum != null || p.valueText != null)
      .map((p) => ({
        propertyDefId: p.propertyDefId,
        valueText: p.valueText ?? null,
        valueNum: p.valueNum ?? null,
        unit: p.unit ?? null,
      })),
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
