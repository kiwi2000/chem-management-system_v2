import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * グループの用途。
 * NEWS = ホームのお知らせを見出しで区切るための分類
 * ORG  = 使っていない。組織の所属は「組織」へ移した（2026-08-30）。表の値に合わせて残してある
 */
export const GROUP_KINDS = ["NEWS", "ORG"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

export const groupSchema = (m: Messages) =>
  z.object({
    kind: z.enum(GROUP_KINDS),
    nameJa: z.string().trim().min(1, m.validation.required).max(100, m.validation.tooLong(100)),
    nameEn: z
      .string()
      .trim()
      .max(100, m.validation.tooLong(100))
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    displayOrder: z.number().int().min(0).max(9999),
    activeFlag: z.boolean(),
  });

export type GroupInput = z.infer<ReturnType<typeof groupSchema>>;
