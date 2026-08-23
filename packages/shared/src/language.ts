import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 言語。法規制の名称で「原文の言語」として選ぶ。
 * コードは ISO 639-1 を大文字にした2文字（JA, EN, ZH …）。
 */
export const languageSchema = (m: Messages) =>
  z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, m.languages.codeFormat),
    nameJa: z.string().trim().min(1, m.validation.required).max(100, m.validation.tooLong(100)),
    nameEn: z.string().trim().min(1, m.validation.required).max(100, m.validation.tooLong(100)),
    displayOrder: z.number().int().min(0).max(9999),
  });

export type LanguageInput = z.infer<ReturnType<typeof languageSchema>>;
