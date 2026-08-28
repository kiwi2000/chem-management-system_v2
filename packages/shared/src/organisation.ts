import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 組織（会社・事業所）。帳票に載せる差出人の情報。
 *
 * **持つ項目は決めない。**会社名・住所・電話・登録番号・担当窓口…と、
 * 業種や提出先によって求められるものが違う。項目名も値も打ってもらう。
 */
export const organisationItemSchema = (m: Messages) =>
  z.object({
    label: z.string().trim().min(1, m.validation.required).max(60, m.validation.tooLong(60)),
    value: z.string().trim().max(500, m.validation.tooLong(500)),
  });

export const organisationSchema = (m: Messages) =>
  z.object({
    code: z
      .string()
      .trim()
      .min(1, m.validation.required)
      .max(20, m.validation.tooLong(20))
      .regex(/^[A-Za-z0-9_-]+$/, m.validation.orgCodeFormat),
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
    /*
      項目は**まるごと入れ替える。**1件ずつ足し引きする作りにすると、
      画面で消した行がサーバーに伝わらず、消したはずのものが帳票に出る
    */
    items: z.array(organisationItemSchema(m)).max(50),
  });

export type OrganisationInput = z.infer<ReturnType<typeof organisationSchema>>;

/** 同じ項目名が2つあると、帳票からどちらが出るか決まらない */
export function duplicateLabels(items: { label: string }[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const it of items) {
    const key = it.label.trim();
    if (key === "") continue;
    if (seen.has(key)) dup.add(key);
    seen.add(key);
  }
  return [...dup];
}
