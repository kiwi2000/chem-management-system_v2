import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * PRTR（S22）。工場 → グループ → 会社の 3 段。
 *
 * データを入れるのは工場、届け出るのはグループ（お客様の運用では都道府県）。
 * 利用者は工場かグループのどちらか 1 つを担当する。
 * 仕様は docs/steps/S22_PRTR集計と届出.md
 */

const optText = (m: Messages, max: number) =>
  z
    .string()
    .trim()
    .max(max, m.validation.tooLong(max))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/** 郵便番号は 7 桁の数字（ハイフンは取り除いて持つ）。空は許す */
const zipSchema = (m: Messages) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/-/g, ""))
    .refine((v) => v === "" || /^\d{7}$/.test(v), m.prtr.validation.zip)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/** 住所（届出の本紙の形）。グループと事業者で同じ */
const addressFields = (m: Messages) => ({
  zip: zipSchema(m),
  prefecture: optText(m, 50),
  city: optText(m, 100),
  town: optText(m, 200),
  prefectureKana: optText(m, 100),
  cityKana: optText(m, 200),
  townKana: optText(m, 400),
});

/** グループ（届出上の事業所） */
export const prtrGroupSchema = (m: Messages) =>
  z.object({
    code: z.string().trim().min(1, m.validation.required).max(50, m.validation.tooLong(50)),
    nameJa: z.string().trim().min(1, m.validation.required).max(200, m.validation.tooLong(200)),
    nameKana: optText(m, 200),
    nameEn: optText(m, 200),
    ...addressFields(m),
    employeeNum: z.number().int().min(0).max(9_999_999).nullable().optional(),
    displayOrder: z.number().int().min(0).max(999_999).optional(),
    note: optText(m, 2000),
  });
export type PrtrGroupInput = z.infer<ReturnType<typeof prtrGroupSchema>>;

/** 工場 */
export const prtrSiteSchema = (m: Messages) =>
  z.object({
    code: z.string().trim().min(1, m.validation.required).max(50, m.validation.tooLong(50)),
    groupId: z.string().trim().min(1, m.validation.required),
    nameJa: z.string().trim().min(1, m.validation.required).max(200, m.validation.tooLong(200)),
    nameEn: optText(m, 200),
    displayOrder: z.number().int().min(0).max(999_999).optional(),
    note: optText(m, 2000),
  });
export type PrtrSiteInput = z.infer<ReturnType<typeof prtrSiteSchema>>;

/** 業種。コードは 4 桁の数字（届出の手引きの業種コード） */
export const prtrIndustrySchema = (m: Messages) =>
  z.object({
    code: z
      .string()
      .trim()
      .regex(/^\d{4}$/, m.prtr.validation.industryCode),
    name: z.string().trim().min(1, m.validation.required).max(200, m.validation.tooLong(200)),
    defaultMinisterId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    active: z.boolean().optional(),
  });
export type PrtrIndustryInput = z.infer<ReturnType<typeof prtrIndustrySchema>>;

/** 主務大臣 */
export const prtrMinisterSchema = (m: Messages) =>
  z.object({
    name: z.string().trim().min(1, m.validation.required).max(100, m.validation.tooLong(100)),
    active: z.boolean().optional(),
  });
export type PrtrMinisterInput = z.infer<ReturnType<typeof prtrMinisterSchema>>;

/** 事業者（届出者）。組織マスタの会社に添える項目 */
export const prtrRegistrantSchema = (m: Messages) =>
  z.object({
    nameKana: optText(m, 200),
    representName: optText(m, 200),
    representNameKana: optText(m, 200),
    agentName: optText(m, 200),
    agentNameKana: optText(m, 200),
    corporateNumber: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{13}$/.test(v), m.prtr.validation.corporateNumber)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    lastYearCompanyName: optText(m, 200),
    ...addressFields(m),
  });
export type PrtrRegistrantInput = z.infer<ReturnType<typeof prtrRegistrantSchema>>;

/**
 * 利用者の担当。工場かグループのどちらか一方。null は「担当なし」。
 * PRTR 管理者は担当を持たない（全グループ）
 */
export const prtrScopeSchema = z
  .object({
    siteId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    groupId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
  })
  .nullable()
  .optional();
export type PrtrScopeInput = z.infer<typeof prtrScopeSchema>;
