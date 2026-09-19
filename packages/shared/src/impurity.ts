import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 不純物種別（S21）。
 *
 * 「同じ該非判定になる不純物どうし」をまとめた区分。物質の属性として持ち、
 * 種別ごとに「どの規制区分・法文物質名で非該当にするか」を設定する。
 * 組み込みの 2 つは id を固定してある（データソースの `src-user` と同じやり方）。
 */
/** 0「不純物ではない」。既定。除外の設定を持たない */
export const IMPURITY_NONE = "ip-none";
/** 1「不純物」。組み込み。たいていの会社はこれだけで足りる */
export const IMPURITY_BUILTIN = "ip-impurity";

export const impurityTypeSchema = (m: Messages) =>
  z.object({
    code: z.string().trim().min(1, m.validation.required).max(50, m.validation.tooLong(50)),
    nameJa: z.string().trim().min(1, m.validation.required).max(200, m.validation.tooLong(200)),
    nameEn: z.string().trim().max(200, m.validation.tooLong(200)).optional().nullable(),
    note: z.string().trim().max(2000, m.validation.tooLong(2000)).optional().nullable(),
  });
export type ImpurityTypeInput = z.infer<ReturnType<typeof impurityTypeSchema>>;

/** 区分の除外：付ける／外す */
export const impurityExemptionSchema = z.object({
  categoryIds: z.array(z.string().min(1)).min(1).max(500),
  excluded: z.boolean(),
});
export type ImpurityExemptionInput = z.infer<typeof impurityExemptionSchema>;

/** 法文物質名の上書き：null は「区分に従う」（行を消す） */
export const impurityExemptionSubstanceSchema = z.object({
  statutorySubstanceId: z.string().min(1),
  excluded: z.boolean().nullable(),
});
export type ImpurityExemptionSubstanceInput = z.infer<typeof impurityExemptionSubstanceSchema>;
