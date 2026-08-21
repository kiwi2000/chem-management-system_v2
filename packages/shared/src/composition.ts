import { z } from "zod";
import { SCALED_HUNDRED, fromScaled, sumScaled, toScaled } from "./decimal";
import type { Messages } from "./i18n/ja";
import type { AppSettings } from "./settings";

/**
 * 原組成。製品に「何がどれだけ入っているか」を1段だけ持つ。
 * 多段の展開（親×子の掛け算で物質まで下ろす）は S11 で別に作る。
 */

/** 1製品あたりの行数の上限 */
export const COMPOSITION_MAX_LINES = 100;

export const COMPOSITION_VALIDATION_MODES = ["STRICT", "STANDARD", "LENIENT"] as const;
export type CompositionValidationMode = (typeof COMPOSITION_VALIDATION_MODES)[number];

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable());

/** 含有率は文字列で受け渡す（浮動小数点を経由させないため）。小数6桁まで */
const pctString = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,6})?$/);

/**
 * 組成の1行。
 * 構成要素は物質か子製品のどちらか一方、balance（残部）行は含有率を持たない。
 * この2つは形の問題なのでスキーマで見る（存在確認や循環はサーバー側）。
 */
export const compositionLineSchema = (m: Messages) =>
  z
    .object({
      substanceId: emptyToNull(z.string().trim().max(50)).optional(),
      childProductId: emptyToNull(z.string().trim().max(50)).optional(),
      contentPct: emptyToNull(pctString).optional(),
      isBalance: z.boolean(),
      note: emptyToNull(z.string().trim().max(500, m.validation.tooLong(500))).optional(),
    })
    .superRefine((line, ctx) => {
      const hasSubstance = !!line.substanceId;
      const hasProduct = !!line.childProductId;
      if (hasSubstance === hasProduct) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["substanceId"],
          message: m.composition.errorPickOne,
        });
      }

      if (line.isBalance) {
        if (line.contentPct != null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contentPct"],
            message: m.composition.errorBalanceHasPct,
          });
        }
        return;
      }

      if (line.contentPct == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contentPct"],
          message: m.composition.errorPctRequired,
        });
        return;
      }
      const scaled = toScaled(line.contentPct);
      if (scaled === null || scaled <= 0n || scaled > SCALED_HUNDRED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contentPct"],
          message: m.validation.percentRange,
        });
      }
    });

export const compositionSchema = (m: Messages) =>
  z.object({
    lines: z
      .array(compositionLineSchema(m))
      .max(COMPOSITION_MAX_LINES, m.validation.tooMany(COMPOSITION_MAX_LINES)),
  });

export type CompositionLineInput = z.infer<ReturnType<typeof compositionLineSchema>>;
export type CompositionInput = z.infer<ReturnType<typeof compositionSchema>>;

/** 合計検証に必要な部分だけ（画面は入力途中の値でも呼べるようにする） */
export interface SumLine {
  contentPct: string | null;
  isBalance: boolean;
}

export interface CompositionSumResult {
  /** 1件でもあれば保存しない */
  errors: string[];
  /** 保存はするが伝える */
  warnings: string[];
  /** 既知成分（balance行を除く）の合計 */
  totalPct: string;
  /** balance行に入る値。balance行が無ければ null */
  balancePct: string | null;
}

/**
 * 含有率合計の検証。厳しさはシステム設定で切り替える。
 *
 * | モード | 100%未満 | 100%超 |
 * |---|---|---|
 * | STRICT | エラー | エラー |
 * | STANDARD | 警告 | エラー |
 * | LENIENT | 何もしない | 警告 |
 *
 * 画面とサーバーの両方から呼ぶ（同じ判定を2か所に書かないため）。
 */
export function validateCompositionSum(
  lines: SumLine[],
  settings: AppSettings,
  m: Messages,
): CompositionSumResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const balanceLines = lines.filter((l) => l.isBalance);
  const knownLines = lines.filter((l) => !l.isBalance);
  const total = sumScaled(knownLines.map((l) => l.contentPct));
  const totalPct = fromScaled(total);

  if (lines.length === 0) {
    return { errors, warnings: [m.composition.warnEmpty], totalPct: "0", balancePct: null };
  }

  if (balanceLines.length > 1) {
    errors.push(m.composition.errorBalanceMultiple);
  }

  const epsilon = toScaled(settings.compositionEpsilonPct) ?? 0n;
  const mode = settings.compositionValidationMode;

  if (balanceLines.length > 0) {
    const balance = SCALED_HUNDRED - total;
    if (balance < -epsilon) {
      // 既知成分だけで 100% を超えている。残部に入れる値が無い
      if (mode === "LENIENT") {
        warnings.push(m.composition.warnSumOver(totalPct));
        return { errors, warnings, totalPct, balancePct: "0" };
      }
      errors.push(m.composition.errorBalanceNegative(totalPct));
      return { errors, warnings, totalPct, balancePct: "0" };
    }
    // 誤差の範囲で少しだけ超えている場合は 0 に丸める
    return {
      errors,
      warnings,
      totalPct,
      balancePct: fromScaled(balance < 0n ? 0n : balance),
    };
  }

  if (total > SCALED_HUNDRED + epsilon) {
    const message = m.composition.warnSumOver(totalPct);
    if (mode === "LENIENT") warnings.push(message);
    else errors.push(message);
  } else if (total < SCALED_HUNDRED - epsilon) {
    if (mode === "STRICT") errors.push(m.composition.errorSumNot100(totalPct));
    else if (mode === "STANDARD") warnings.push(m.composition.warnSumUnder(totalPct));
  }

  return { errors, warnings, totalPct, balancePct: null };
}
