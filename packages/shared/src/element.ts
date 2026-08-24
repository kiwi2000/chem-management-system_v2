import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 元素。法文物質名の「換算先」で選ぶための一覧。
 *
 * キーは元素記号。換算係数の表が記号で持っているので、そのまま突き合わせられる。
 * シアン（CN）のように元素でないものも入るため、記号は3文字まで許し、
 * 番号は900番台を使う（実在する原子番号は最大118）。
 */
export const elementSchema = (m: Messages) =>
  z.object({
    symbol: z
      .string()
      .trim()
      .min(1, m.validation.required)
      .max(4, m.validation.tooLong(4))
      .regex(/^[A-Z][A-Za-z]{0,2}$/, m.elements.symbolFormat),
    atomicNumber: z.number().int().min(1).max(999),
    nameJa: z.string().trim().min(1, m.validation.required).max(100, m.validation.tooLong(100)),
    nameEn: z.string().trim().min(1, m.validation.required).max(100, m.validation.tooLong(100)),
  });

export type ElementInput = z.infer<ReturnType<typeof elementSchema>>;
