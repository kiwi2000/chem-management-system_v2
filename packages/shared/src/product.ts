import { z } from "zod";
import type { Messages } from "./i18n/ja";
import { aliasesSchema, propertyValuesSchema } from "./substance";

export const PRODUCT_STATUSES = ["ACTIVE", "DISCONTINUED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const emptyToNull = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable());

/**
 * 製品 / 原材料。両者は同じもので、`usableAsMaterial` が立っているものだけ
 * 他製品の組成に部品として入れられる。
 *
 * 誰に何を見せるかは製品ごとのフラグではなく、ユーザーの権限だけで決める。
 */
export const productSchema = (m: Messages) =>
  z.object({
    code: z.string().trim().min(1, m.validation.required).max(20, m.validation.tooLong(20)),
    nameJa: z.string().trim().min(1, m.validation.required).max(500, m.validation.tooLong(500)),
    nameEn: emptyToNull(z.string().trim().max(500, m.validation.tooLong(500))).optional(),
    status: z.enum(PRODUCT_STATUSES),
    note: emptyToNull(z.string().trim().max(2000, m.validation.tooLong(2000))).optional(),

    usableAsMaterial: z.boolean(),
    /** 型式。システム設定の選択肢から1つ。未選択は null */
    modelValue: emptyToNull(z.string().trim().max(100)).optional(),
    /** 用途。システム設定の選択肢から複数。並び順がそのまま表示順 */
    uses: z.array(z.string().trim().min(1).max(100)).max(50),

    aliases: aliasesSchema(m),
    properties: propertyValuesSchema,
  });

export type ProductInput = z.infer<ReturnType<typeof productSchema>>;
