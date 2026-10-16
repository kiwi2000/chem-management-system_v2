import type { Messages } from "@chem/shared";
import type { PropertyDef, PropertyOption } from "@prisma/client";

/** 画面から届く拡張属性の値（物質・製品で同じ形） */
export interface PropertyValueInput {
  propertyDefId: string;
  valueText?: string | null | undefined;
  valueNum?: string | null | undefined;
  unit?: string | null | undefined;
  conditionCode?: string | null | undefined;
  conditionText?: string | null | undefined;
}

type DefWithOptions = PropertyDef & { options: PropertyOption[] };

/**
 * 拡張属性の値の検証。辞書とDBの定義を突き合わせないと判定できない部分。
 * 返り値が空でなければ 400 で止める。
 *
 * `defs` は用途（物質/製品）でフィルターしたものを渡すこと。
 * 絞らずに渡すと、製品の項目IDを物質に付けるような取り違えを通してしまう。
 *
 * 選択肢は「使わない」にしたものも通す（入力済みの値を、直さずに保存し直せるように）。
 * 画面の側で、新しく選べるのは使うものだけにしている
 */
export function validatePropertyValues(
  values: PropertyValueInput[],
  defs: DefWithOptions[],
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
    if (!ok) {
      errors.push(m.errors.propertyTypeMismatch(def.labelJa));
      continue;
    }
    // 選択肢の項目は、登録したコードだけ（自由な文字は入れない）
    if (
      def.dataType === "CHOICE" &&
      !def.options.some((o) => o.kind === "VALUE" && o.code === p.valueText)
    ) {
      errors.push(m.errors.propertyChoiceUnknown(def.labelJa));
    }
    // 条件は、選択肢のコードか「その他」の自由記入のどちらか一方
    if (p.conditionCode != null) {
      const known = def.options.some((o) => o.kind === "CONDITION" && o.code === p.conditionCode);
      if (!known || p.conditionText != null) {
        errors.push(m.errors.propertyConditionUnknown(def.labelJa));
      }
    }
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
      conditionCode: p.conditionCode ?? null,
      conditionText: p.conditionText ?? null,
    }));
}
