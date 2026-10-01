import { z } from "zod";
import type { Messages } from "./i18n/ja";

/**
 * PRTR 届出データの入力（S22）。
 *
 * 所属（組織マスタの組織）× 年度で 1 組。製品ごとの数量（購入・出荷と、排出の数え方の印）と、
 * 物質ごとの数量（取扱量の直接入力・実測排出量）を入れ、集計で物質ごとに足す（2026-10-01 設計）。
 * 仕様は docs/steps/S22_PRTR集計と届出.md
 */

/** 排出の数え方（製品の行の印）: 実測で捕捉／物質収支／排出係数 */
export const PRTR_METHODS = ["MEASURED", "BALANCE", "FACTOR"] as const;
export type PrtrMethod = (typeof PRTR_METHODS)[number];

/** 取り込みの列で印を書く言葉。大文字小文字・空白は無視して当てる */
export const PRTR_METHOD_ALIASES: Record<PrtrMethod, string[]> = {
  MEASURED: ["MEASURED", "実測で捕捉", "実測", "実測値", "measured"],
  BALANCE: ["BALANCE", "物質収支", "収支", "balance", "mass balance"],
  FACTOR: ["FACTOR", "排出係数", "係数", "factor", "emission factor"],
};

/** 印の言葉 → 印。当たらなければ null */
export function parsePrtrMethod(text: string): PrtrMethod | null {
  const norm = (x: string) => x.replace(/[\s\u3000]/g, "").toLowerCase();
  const v = norm(text);
  if (v === "") return null;
  for (const k of PRTR_METHODS) {
    if (PRTR_METHOD_ALIASES[k].some((a) => norm(a) === v)) return k;
  }
  return null;
}

/** 年度（4 月〜翌 3 月）。いま入っている年度 */
export function currentFiscalYear(now = new Date()): number {
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}

/** 届出の対象は前年度。画面の既定はこれ */
export function defaultPrtrFiscalYear(now = new Date()): number {
  return currentFiscalYear(now) - 1;
}

/** kg。0 以上、小数 3 桁まで。数値は文字列で持つ（Float を使わない） */
const kgSchema = (m: Messages) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,15}(\.\d{1,3})?$/, m.prtr.validation.kg);

/** 排出係数（%）。0 以上、小数 4 桁まで */
const factorSchema = (m: Messages) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,5}(\.\d{1,4})?$/, m.prtr.validation.factor);

const optKg = (m: Messages) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .refine((v) => v == null || /^\d{1,15}(\.\d{1,3})?$/.test(v), m.prtr.validation.kg);

/** 届出データの頭（所属 × 年度）。係数は入っていれば形を確かめる（排出係数のタブで使う） */
export const prtrEntrySchema = (m: Messages) =>
  z
    .object({
      organisationId: z.string().trim().min(1, m.validation.required),
      fiscalYear: z.number().int().min(2000).max(2100),
      factorPct: z
        .string()
        .trim()
        .transform((v) => (v === "" ? null : v))
        .nullable()
        .optional(),
      note: z
        .string()
        .trim()
        .max(2000, m.validation.tooLong(2000))
        .transform((v) => (v === "" ? null : v))
        .nullable()
        .optional(),
    })
    .superRefine((v, ctx) => {
      if (v.factorPct != null && !factorSchema(m).safeParse(v.factorPct).success) {
        ctx.addIssue({ code: "custom", path: ["factorPct"], message: m.prtr.validation.factor });
      }
    });
export type PrtrEntryInput = z.infer<ReturnType<typeof prtrEntrySchema>>;

/** 製品ごとの数量。製品は製品コードで当てる。`method` は排出の数え方の印 */
export const prtrQuantitySchema = (m: Messages) =>
  z.object({
    method: z.enum(PRTR_METHODS),
    productCode: z.string().trim().min(1, m.validation.required).max(20, m.validation.tooLong(20)),
    purchasedKg: kgSchema(m),
    shippedKg: optKg(m),
  });
export type PrtrQuantityInput = z.infer<ReturnType<typeof prtrQuantitySchema>>;

/**
 * 物質ごとの数量（取扱量の直接入力・実測排出量）。どちらか 1 つは要る。
 * 物質は本システムの物質コードで当て、化管法の第一種指定化学物質に変換する
 */
export const prtrMeasuredSchema = (m: Messages) =>
  z
    .object({
      substanceCode: z
        .string()
        .trim()
        .min(1, m.validation.required)
        .max(50, m.validation.tooLong(50)),
      handledKg: optKg(m),
      measuredKg: optKg(m),
    })
    .refine((v) => v.handledKg != null || v.measuredKg != null, {
      path: ["measuredKg"],
      message: m.prtr.validation.eitherKg,
    });
export type PrtrMeasuredInput = z.infer<ReturnType<typeof prtrMeasuredSchema>>;

/*
  ── 取り込み ──────────────────────────────────────────
  1 行目を見出しとして読み、どの列を何に使うかを利用者が割り当てる。
  必要な項目がそろっていれば、余分な列があっても順番が違ってもよい（2026-09-21 決定）
*/
export const PRTR_IMPORT_KINDS = ["quantities", "measured"] as const;
export type PrtrImportKind = (typeof PRTR_IMPORT_KINDS)[number];

/** 取り込みの項目。required は方法によらず必須のもの */
export const PRTR_IMPORT_FIELDS: Record<
  PrtrImportKind,
  { key: string; required: boolean; aliases: string[] }[]
> = {
  quantities: [
    { key: "productCode", required: true, aliases: ["製品コード", "product code", "code"] },
    {
      key: "productName",
      required: false,
      aliases: ["製品名", "製品名称", "product name", "name"],
    },
    {
      key: "purchasedKg",
      required: true,
      aliases: ["購入数量", "購入数量(kg)", "購入", "purchased"],
    },
    { key: "shippedKg", required: false, aliases: ["出荷数量", "出荷数量(kg)", "出荷", "shipped"] },
    // 排出の数え方の印。列が無い行は窓で選んだ既定の印
    { key: "method", required: false, aliases: ["排出の数え方", "数え方", "方法", "method"] },
  ],
  measured: [
    { key: "substanceCode", required: true, aliases: ["物質コード", "substance code", "code"] },
    {
      key: "substanceName",
      required: false,
      aliases: ["物質名", "物質名称", "substance name", "name"],
    },
    // 取扱量・実測排出量はどちらか 1 つが要る（行ごとに確かめる）
    { key: "handledKg", required: false, aliases: ["取扱量", "取扱量(kg)", "handled"] },
    {
      key: "measuredKg",
      required: false,
      aliases: ["実測排出量", "実測排出量(kg)", "実測値", "実測値(kg)", "排出量", "measured"],
    },
  ],
};

/** 見出しの文字が項目名と同じ列は最初から割り当てる。大文字小文字・全角半角の空白は無視 */
export function guessColumn(headers: string[], aliases: string[]): number | null {
  const norm = (s: string) => s.replace(/[\s\u3000]/g, "").toLowerCase();
  const wanted = aliases.map(norm);
  const i = headers.findIndex((h) => wanted.includes(norm(h)));
  return i >= 0 ? i : null;
}

export const PRTR_IMPORT_MODES = ["upsert", "replace"] as const;
export type PrtrImportMode = (typeof PRTR_IMPORT_MODES)[number];

/** 取り込みの指示（列の割り当てと重ね方）。数量はどの方法（タブ）に入れるかも要る */
export const prtrImportSchema = z
  .object({
    kind: z.enum(PRTR_IMPORT_KINDS),
    /** 製品ごとの数量で、印の列が無い行に付ける既定の印。物質ごとの数量では使わない */
    method: z.enum(PRTR_METHODS).optional(),
    /** 項目 → 列番号（0 始まり）。割り当てない項目は入れない */
    mapping: z.record(z.string(), z.number().int().min(0)),
    /** 数量の重ね方。実測値では使わない */
    mode: z.enum(PRTR_IMPORT_MODES).optional(),
    /** 実測値で、既に値がある物質を上書きしてよいと答えたか */
    overwrite: z.boolean().optional(),
    /** true なら下見だけ（何も書かない） */
    dryRun: z.boolean().optional(),
  })
  .refine((v) => v.kind !== "quantities" || v.method !== undefined, {
    path: ["method"],
    message: "method is required for quantities",
  });
export type PrtrImportInput = z.infer<typeof prtrImportSchema>;
