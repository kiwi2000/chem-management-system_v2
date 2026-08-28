import { z } from "zod";
import { THRESHOLD_BASES } from "./constants";
import type { Messages } from "./i18n/ja";

/**
 * 法規制のマスタ。階層は 法律 → 区分 → 分類 → 法文物質名。
 *
 * 名称はどの段も「原文・原文の言語・日本語・英語」の4つで持つ。
 * 中国や韓国の法律は原文が現地語で、日本語訳が無いこともあるため。
 *
 * 閾値は4欄（下限値・下限の境目・上限値・上限の境目）で、すべて必須。
 * 空欄という状態を作らないことで、「空欄をどう読むか」という暗黙の規則を消してある。
 * 区分が持つのは**ひな型**で、判定に使うのは法文物質名の側だけ。
 */

/** 閾値の境目。下限では 超/以上、上限では 未満/以下 を表す */
export const THRESHOLD_BOUNDS = ["EXCLUSIVE", "INCLUSIVE"] as const;
export type ThresholdBound = (typeof THRESHOLD_BOUNDS)[number];

/** 含有率として受け付ける形。0〜100、小数は6桁まで */
const pct = (m: Messages) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, m.validation.numberFormat)
    .refine((v) => Number(v) >= 0 && Number(v) <= 100, m.validation.percentRange);

const code = (m: Messages) =>
  z.string().trim().min(1, m.validation.required).max(50, m.validation.tooLong(50));

const displayOrder = () => z.number().int().min(0).max(99999);

const optionalText = (m: Messages, max: number) =>
  z
    .string()
    .trim()
    .max(max, m.validation.tooLong(max))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/**
 * 名称の4つ組。原文は必須。
 * 化学物質の名称は長い（安衛法の一覧には日本語522文字・英語626文字の実例がある）ので、
 * 上限は余裕をもって取る。
 */
const NAME_MAX = 2000;
const nameFields = (m: Messages) => ({
  nameOriginal: z
    .string()
    .trim()
    .min(1, m.validation.required)
    .max(NAME_MAX, m.validation.tooLong(NAME_MAX)),
  nameLang: z.string().trim().min(1, m.validation.required).max(10, m.validation.tooLong(10)),
  nameJa: optionalText(m, NAME_MAX),
  nameEn: optionalText(m, NAME_MAX),
});

/** 閾値の4欄。下限が上限を超えていたら弾く */
const thresholdFields = (m: Messages) => ({
  thresholdLower: pct(m),
  lowerBound: z.enum(THRESHOLD_BOUNDS),
  thresholdUpper: pct(m),
  upperBound: z.enum(THRESHOLD_BOUNDS),
});

const withThresholdOrder = <T extends z.ZodTypeAny>(schema: T, m: Messages) =>
  schema.superRefine((v: { thresholdLower: string; thresholdUpper: string }, ctx) => {
    if (Number(v.thresholdLower) > Number(v.thresholdUpper)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["thresholdUpper"],
        message: m.validation.thresholdOrder,
      });
    }
  });

export const lawSchema = (m: Messages) =>
  z.object({
    code: code(m),
    countryId: z.string().trim().min(1, m.validation.required),
    ...nameFields(m),
    displayOrder: displayOrder(),
    note: optionalText(m, 2000),
  });

export const regulationCategorySchema = (m: Messages) =>
  withThresholdOrder(
    z.object({
      code: code(m),
      lawId: z.string().trim().min(1, m.validation.required),
      ...nameFields(m),
      ...thresholdFields(m),
      displayOrder: displayOrder(),
      /** 閾値が何に対する濃度か。均質材料あたりなら必ず要確認になる */
      thresholdBasis: z.enum(THRESHOLD_BASES),
      interactionGroup: optionalText(m, 50),
      rank: z.number().int().min(0).max(999).nullable().optional(),
      note: optionalText(m, 2000),
    }),
    m,
  );

/**
 * 分類。区分を分けないときは名称を空にする（画面に出さない受け皿になる）。
 * 原文名と言語は、そろっているか両方空かのどちらか。
 */
export const regulationClassSchema = (m: Messages) =>
  z
    .object({
      code: code(m),
      categoryId: z.string().trim().min(1, m.validation.required),
      nameOriginal: optionalText(m, NAME_MAX),
      nameLang: optionalText(m, 10),
      nameJa: optionalText(m, NAME_MAX),
      nameEn: optionalText(m, NAME_MAX),
      displayOrder: displayOrder(),
      interactionGroup: optionalText(m, 50),
      rank: z.number().int().min(0).max(999).nullable().optional(),
      note: optionalText(m, 2000),
    })
    .superRefine((v, ctx) => {
      if ((v.nameOriginal == null) !== (v.nameLang == null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nameLang"],
          message: m.validation.namePair,
        });
      }
    });

export const statutorySubstanceSchema = (m: Messages) =>
  withThresholdOrder(
    z.object({
      code: code(m),
      classId: z.string().trim().min(1, m.validation.required),
      officialNumber: optionalText(m, 50),
      ...nameFields(m),
      ...thresholdFields(m),
      displayOrder: displayOrder(),
      /** 参考情報。判定には使わない */
      effectiveFrom: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, m.validation.dateFormat)
        .nullable()
        .optional()
        .or(z.literal("").transform(() => null)),
      effectiveTo: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, m.validation.dateFormat)
        .nullable()
        .optional()
        .or(z.literal("").transform(() => null)),
      note: optionalText(m, 2000),
    }),
    m,
  );

export type LawInput = z.infer<ReturnType<typeof lawSchema>>;
export type RegulationCategoryInput = z.infer<ReturnType<typeof regulationCategorySchema>>;
export type RegulationClassInput = z.infer<ReturnType<typeof regulationClassSchema>>;
export type StatutorySubstanceInput = z.infer<ReturnType<typeof statutorySubstanceSchema>>;

/**
 * 閾値を1行で読める形にする（例: `0 < x ≤ 100`）。
 * 一覧に4列出すと場所を食って読みにくいので、見るときは1列、直すときだけ4欄に分ける。
 */
export function formatThreshold(
  lower: string,
  lowerBound: ThresholdBound,
  upper: string,
  upperBound: ThresholdBound,
): string {
  const trim = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);
  const lo = lowerBound === "INCLUSIVE" ? "≤" : "<";
  const hi = upperBound === "INCLUSIVE" ? "≤" : "<";
  return `${trim(lower)} ${lo} x ${hi} ${trim(upper)}`;
}

/**
 * 名称の出し分け。**見ている言語の訳 → 原文 → もう一方の訳** の順に、あるものを出す。
 *
 * 訳より先に原文を見るのは、日本の法律では原文がそのまま日本語だから。
 * 英語名だけを頼りにすると、日本語の画面に英語の法律名が出てしまう。
 */
export function pickStatutoryName(
  locale: "ja" | "en",
  nameOriginal: string | null,
  nameJa: string | null,
  nameEn: string | null,
): string {
  const mine = locale === "ja" ? nameJa : nameEn;
  const other = locale === "ja" ? nameEn : nameJa;
  return mine ?? nameOriginal ?? other ?? "";
}
