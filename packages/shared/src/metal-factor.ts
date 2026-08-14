import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 金属換算係数。
 * CAS番号 × 金属元素 をキーに、その金属が重量で何パーセント含まれるかを持つ。
 */
export const metalFactorSchema = (m: Messages) =>
  z.object({
    /** ここでは CAS がキーなので、システム設定に関係なく必須 */
    casNumber: z.string().trim().min(1, m.validation.required).max(20, m.validation.tooLong(20)),
    metalElement: z
      .string()
      .trim()
      .min(1, m.validation.required)
      .max(4)
      .regex(/^[A-Z][a-z]{0,2}$/, m.validation.elementFormat),
    /** 重量パーセント。0 より大きく 100 以下。小数は6桁まで */
    ratioPct: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,6})?$/, m.validation.numberFormat)
      .refine((v) => Number(v) > 0 && Number(v) <= 100, m.validation.percentRange),
  });

export type MetalFactorInput = z.infer<ReturnType<typeof metalFactorSchema>>;
