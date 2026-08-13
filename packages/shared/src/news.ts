import { z } from "zod";
import type { Messages } from "./i18n/ja";

/** 日付入力（YYYY-MM-DD）。未入力は null として扱う */
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

export const newsSchema = (m: Messages) =>
  z
    .object({
      titleJa: z.string().trim().min(1, m.validation.required).max(200),
      bodyJa: z.string().trim().min(1, m.validation.required).max(20000),
      titleEn: z.string().trim().max(200).nullable().optional(),
      bodyEn: z.string().trim().max(20000).nullable().optional(),
      status: z.enum(["DRAFT", "PUBLISHED"]),
      pinned: z.boolean(),
      publishFrom: dateOnly,
      publishUntil: dateOnly,
    })
    .refine((v) => !v.publishFrom || !v.publishUntil || v.publishFrom <= v.publishUntil, {
      message: m.validation.publishRangeReversed,
      path: ["publishUntil"],
    });

export type NewsInput = z.infer<ReturnType<typeof newsSchema>>;
