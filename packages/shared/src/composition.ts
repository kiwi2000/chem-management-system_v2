import { z } from "zod";
import { SCALED_HUNDRED, fromScaled, sumScaled, toScaled } from "./decimal";
import type { Messages } from "./i18n/ja";
import type { AppSettings } from "./settings";

/**
 * 原組成。製品に「何がどれだけ入っているか」を1段だけ持つ。
 *
 * 原材料の中身まで下ろして見せる「展開」は、この1段を積み重ねて作る。
 * 保存するのはあくまで1段だけで、展開は見せかたの話（記録は置き換えない）。
 */

/** 1製品あたりの行数の上限 */
export const COMPOSITION_MAX_LINES = 100;

/**
 * 展開してたどれる深さの上限。
 * 循環は保存時に止めている（wouldCreateCycle）ので、展開は放っておいても必ず終わる。
 * これは、取り込みなどで壊れた形が入り込んだときのための安全網。
 */
export const COMPOSITION_MAX_DEPTH = 20;

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
 * 構成要素は物質か子製品のどちらか一方で、含有率は必ず入れる。
 * 形の問題なのでスキーマで見る（存在確認や循環はサーバー側）。
 */
export const compositionLineSchema = (m: Messages) =>
  z
    .object({
      substanceId: emptyToNull(z.string().trim().max(50)).optional(),
      childProductId: emptyToNull(z.string().trim().max(50)).optional(),
      contentPct: emptyToNull(pctString).optional(),
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
    /**
     * 画面を開いたときの印。**他の人の変更を黙って上書きしないため**に使う。
     * 省いたときは、これまでどおり確かめずに保存する
     */
    stamp: z.string().optional(),
    /** 「このまま保存する」を押したとき。印が食い違っていても通す */
    force: z.boolean().optional(),
  });

export type CompositionLineInput = z.infer<ReturnType<typeof compositionLineSchema>>;
export type CompositionInput = z.infer<ReturnType<typeof compositionSchema>>;

/** 合計検証に必要な部分だけ（画面は入力途中の値でも呼べるようにする） */
export interface SumLine {
  contentPct: string | null;
}

export interface CompositionSumResult {
  /** 1件でもあれば保存しない */
  errors: string[];
  /** 保存はするが伝える */
  warnings: string[];
  /** 入力されている含有率の合計 */
  totalPct: string;
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

  const total = sumScaled(lines.map((l) => l.contentPct));
  const totalPct = fromScaled(total);

  if (lines.length === 0) {
    return { errors, warnings: [m.composition.warnEmpty], totalPct: "0" };
  }

  const epsilon = toScaled(settings.compositionEpsilonPct) ?? 0n;
  const mode = settings.compositionValidationMode;

  if (total > SCALED_HUNDRED + epsilon) {
    const message = m.composition.warnSumOver(totalPct);
    if (mode === "LENIENT") warnings.push(message);
    else errors.push(message);
  } else if (total < SCALED_HUNDRED - epsilon) {
    if (mode === "STRICT") errors.push(m.composition.errorSumNot100(totalPct));
    else if (mode === "STANDARD") warnings.push(m.composition.warnSumUnder(totalPct));
  }

  return { errors, warnings, totalPct };
}
