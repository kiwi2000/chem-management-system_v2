import { z } from "zod";
import type { Messages } from "./i18n/ja";

/** 官報公示整理番号の法令区分。化審法の番号が通称 MITI番号 */
export const GAZETTE_LAW_KINDS = ["CSCL", "ISHA", "OTHER"] as const;
export type GazetteLawKind = (typeof GAZETTE_LAW_KINDS)[number];

export const SUBSTANCE_STATUSES = ["ACTIVE", "DISCONTINUED"] as const;
export type SubstanceStatus = (typeof SUBSTANCE_STATUSES)[number];

export const PROPERTY_DATA_TYPES = ["NUMBER", "TEXT"] as const;
export type PropertyDataType = (typeof PROPERTY_DATA_TYPES)[number];

/** 拡張属性の項目定義が、物質と製品のどちらのものか */
export const PROPERTY_TARGETS = ["SUBSTANCE", "PRODUCT"] as const;
export type PropertyTarget = (typeof PROPERTY_TARGETS)[number];

/** 数値は文字列で受け渡す（浮動小数点を経由させないため） */
const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/);

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable());

/** 拡張属性の値。物質と製品で同じ形 */
export const propertyValuesSchema = z
  .array(
    z.object({
      propertyDefId: z.string().min(1),
      valueText: emptyToNull(z.string().trim().max(2000)).optional(),
      valueNum: emptyToNull(decimalString).optional(),
      unit: emptyToNull(z.string().trim().max(50)).optional(),
    }),
  )
  .max(200);

/** 別名。物質と製品で同じ形 */
export const aliasesSchema = (m: Messages) =>
  z
    .array(
      z.object({
        nameJa: z.string().trim().min(1, m.validation.required).max(500),
        nameEn: emptyToNull(z.string().trim().max(500)).optional(),
      }),
    )
    .max(100, m.validation.tooMany(100));

export const substanceSchema = (m: Messages) =>
  z.object({
    code: z.string().trim().min(1, m.validation.required).max(20, m.validation.tooLong(20)),
    /** CAS は任意（ポリマー・UVCB・企業秘密物質を登録できるようにするため） */
    casNumber: emptyToNull(z.string().trim().max(20, m.validation.tooLong(20))).optional(),
    status: z.enum(SUBSTANCE_STATUSES),
    note: emptyToNull(z.string().trim().max(2000, m.validation.tooLong(2000))).optional(),

    mainNameJa: z.string().trim().min(1, m.validation.required).max(500, m.validation.tooLong(500)),
    mainNameEn: emptyToNull(z.string().trim().max(500, m.validation.tooLong(500))).optional(),

    subNames: aliasesSchema(m),

    gazetteNumbers: z
      .array(
        z.object({
          lawKind: z.enum(GAZETTE_LAW_KINDS),
          number: z.string().trim().min(1, m.validation.required).max(50),
        }),
      )
      .max(50, m.validation.tooMany(50)),

    /** 拡張属性の値。型（数値/テキスト）の整合はサーバー側で定義と突き合わせる */
    properties: propertyValuesSchema,
  });

export type SubstanceInput = z.infer<ReturnType<typeof substanceSchema>>;

/** 拡張属性の項目定義（管理者が作る）。物質用と製品用を target で分ける */
export const propertyDefSchema = (m: Messages) =>
  z.object({
    target: z.enum(PROPERTY_TARGETS),
    key: z
      .string()
      .trim()
      .min(1, m.validation.required)
      .max(50, m.validation.tooLong(50))
      .regex(/^[a-z][a-z0-9_]*$/, m.validation.keyFormat),
    labelJa: z.string().trim().min(1, m.validation.required).max(100),
    labelEn: emptyToNull(z.string().trim().max(100)).optional(),
    dataType: z.enum(PROPERTY_DATA_TYPES),
    defaultUnit: emptyToNull(z.string().trim().max(50)).optional(),
    displayOrder: z.number().int().min(0).max(9999),
    activeFlag: z.boolean(),
  });

export type PropertyDefInput = z.infer<ReturnType<typeof propertyDefSchema>>;
