import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 国。法律の持ち主になる単位で、地域（アジア・欧州など）の配下に置く。
 * EU・EAEU のような国家連合や、国際条約のように国でないものもここに入れる。
 */
export const countrySchema = (m: Messages) =>
  z.object({
    code: z.string().trim().min(1, m.validation.required).max(20, m.validation.tooLong(20)),
    regionId: z.string().trim().min(1, m.validation.required),
    nameJa: z.string().trim().min(1, m.validation.required).max(200, m.validation.tooLong(200)),
    nameEn: z
      .string()
      .trim()
      .max(200, m.validation.tooLong(200))
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    displayOrder: z.number().int().min(0).max(9999),
  });

export type CountryInput = z.infer<ReturnType<typeof countrySchema>>;
