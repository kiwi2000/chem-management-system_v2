import type { Messages } from "@chem/shared";
import type { PropertyDef } from "@prisma/client";

/** 画面から届く拡張属性の値（物質・製品で同じ形） */
export interface PropertyValueInput {
  propertyDefId: string;
  valueText?: string | null | undefined;
  valueNum?: string | null | undefined;
  unit?: string | null | undefined;
}

/**
 * 拡張属性の値の検証。辞書とDBの定義を突き合わせないと判定できない部分。
 * 返り値が空でなければ 400 で止める。
 *
 * `defs` は用途（物質/製品）でフィルターしたものを渡すこと。
 * 絞らずに渡すと、製品の項目IDを物質に付けるような取り違えを通してしまう。
 */
export function validatePropertyValues(
  values: PropertyValueInput[],
  defs: PropertyDef[],
  m: Messages,
): string[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const errors: string[] = [];
  for (const p of values) {
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

/** 入れ替え保存用の行。値が空の行は保存しない（画面上は全項目の欄が並ぶため） */
export function propertyWrites(values: PropertyValueInput[]) {
  return values
    .filter((p) => p.valueNum != null || p.valueText != null)
    .map((p) => ({
      propertyDefId: p.propertyDefId,
      valueText: p.valueText ?? null,
      valueNum: p.valueNum ?? null,
      unit: p.unit ?? null,
    }));
}
