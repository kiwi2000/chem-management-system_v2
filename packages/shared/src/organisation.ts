import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * 組織。会社・部署・取引先・そのほかを、まとめてここで持つ。
 *
 * **持つ項目は決めない。**会社名・住所・電話・登録番号・担当窓口…と、
 * 業種や提出先によって求められるものが違う。項目名も値も打ってもらう。
 *
 * **種別で分けるが、表は分けない。**どれも「名前と項目を持ち、帳票に差し込める入れもの」で
 * 作りが変わらない。分けて持つと、取引先にだけ住所が書けない、といった食い違いが出る。
 */

/** 組織の種別。`OTHER` だけは呼び名を打ってもらう */
export const ORGANISATION_KINDS = ["COMPANY", "DEPARTMENT", "PARTNER", "OTHER"] as const;
export type OrganisationKind = (typeof ORGANISATION_KINDS)[number];

export function isOrganisationKind(v: unknown): v is OrganisationKind {
  return typeof v === "string" && (ORGANISATION_KINDS as readonly string[]).includes(v);
}

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
    kind: z.enum(ORGANISATION_KINDS),
    /** 種別が「そのほか」のときの呼び名。ほかの種別では捨てる */
    kindLabel: z
      .string()
      .trim()
      .max(30, m.validation.tooLong(30))
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

/**
 * 種別の呼び名。**「そのほか」だけは打たれた名前を出す。**
 * 打たれていなければ、そのまま「そのほか」と出す
 */
export function kindLabelOf(
  kind: OrganisationKind,
  kindLabel: string | null | undefined,
  names: Record<OrganisationKind, string>,
): string {
  if (kind === "OTHER" && (kindLabel ?? "").trim() !== "") return kindLabel as string;
  return names[kind];
}

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
