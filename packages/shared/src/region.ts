import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 地域。アジア・欧州・北米・国際条約といった、国より大きいまとまり。
 * 国（日本・アメリカ合衆国など）は地域ではないので、ここには入れない。
 */
export const regionSchema = (m: Messages) =>
  z.object({
    code: z.string().trim().min(1, m.validation.required).max(20, m.validation.tooLong(20)),
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

export type RegionInput = z.infer<ReturnType<typeof regionSchema>>;
