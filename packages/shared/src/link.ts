import { z } from "zod";
import type { Messages } from "./i18n/ja";

const CODE_MAX = 50;

const optionalNote = (m: Messages) =>
  z
    .string()
    .trim()
    .max(2000, m.validation.tooLong(2000))
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/** 印に出す文字の上限。**長いと表のセルが崩れる** */
export const SOURCE_MARK_MAX = 8;

/**
 * 情報源（LOLI・CHRIP・自社データなど）。
 * どのバージョンでどの順に読むかはバージョンの側で決めるので、ここには優先度を持たせない。
 */
export const sourceSchema = (m: Messages) =>
  z.object({
    code: z
      .string()
      .trim()
      .min(1, m.validation.required)
      .max(CODE_MAX, m.validation.tooLong(CODE_MAX)),
    /** 説明。どんなデータで、どこまで載っているかを書く */
    note: optionalNote(m),
    /**
     * 画面で使う色。`#rrggbb` の形だけを通す。
     * **空も通す。**色を決めていないデータソースがあってよい
     */
    color: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, m.validation.badColor)
      .nullish()
      .or(z.literal("").transform(() => null)),
    /**
     * 画面の印に出す文字。**1文字とは限らない。**
     * 空なら、コードの頭文字を使う
     */
    mark: z
      .string()
      .trim()
      .max(SOURCE_MARK_MAX, m.validation.tooLong(SOURCE_MARK_MAX))
      .nullish()
      .transform((v) => (v ? v : null)),
  });

/**
 * バージョン（いつ時点のデータか）。
 * 現在のバージョンの切り替えは専用の操作で行うので、ここには含めない。
 */
export const linkSetVersionSchema = (m: Messages) =>
  z.object({
    code: z
      .string()
      .trim()
      .min(1, m.validation.required)
      .max(CODE_MAX, m.validation.tooLong(CODE_MAX)),
  });

/**
 * データソース（バージョン × データソース種別）。
 * 優先度は登録のときに末尾へ付け、あとから上下に動かして決めるので、ここには含めない。
 */
export const linkVersionSourceSchema = (m: Messages) =>
  z.object({
    versionId: z.string().trim().min(1, m.validation.required),
    sourceId: z.string().trim().min(1, m.validation.required),
    note: optionalNote(m),
  });

/**
 * 法文物質名とCAS番号の結び付き。
 *
 * どのバージョンのどのデータソースに書くかまで含めて1件。
 * 「非該当」（excluded）は、優先度が上のデータソースが下位の内容を打ち消すためのもので、
 * 行が無いこと（＝何も分からない）とは別物。
 */
export const statutoryCasLinkSchema = (m: Messages) =>
  z.object({
    versionId: z.string().trim().min(1, m.validation.required),
    statutorySubstanceId: z.string().trim().min(1, m.validation.required),
    sourceId: z.string().trim().min(1, m.validation.required),
    casNumber: z.string().trim().min(1, m.validation.required).max(20, m.validation.tooLong(20)),
    excluded: z.boolean().default(false),
    note: optionalNote(m),
  });

export type StatutoryCasLinkInput = z.infer<ReturnType<typeof statutoryCasLinkSchema>>;

export type SourceInput = z.infer<ReturnType<typeof sourceSchema>>;
export type LinkSetVersionInput = z.infer<ReturnType<typeof linkSetVersionSchema>>;
export type LinkVersionSourceInput = z.infer<ReturnType<typeof linkVersionSourceSchema>>;
