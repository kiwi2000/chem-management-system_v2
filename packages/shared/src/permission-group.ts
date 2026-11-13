import { z } from "zod";
import type { Messages } from "./i18n/ja";
import { PERMISSIONS } from "./permissions";

/**
 * 管理グループ（S31）の表の印。画面とサーバーの両方で使う。
 * 仕様は docs/steps/S31_組織管理_仕様案.md の 6 章。
 */

/** 表の 6 つの印（列の並び順） */
export const PERMISSION_MARKS = [
  "productView",
  "productEdit",
  "compositionView",
  "compositionEdit",
  "substanceView",
  "substanceEdit",
] as const;
export type PermissionMark = (typeof PERMISSION_MARKS)[number];

/** 表の 1 行の印 */
export type PermissionMarks = Record<PermissionMark, boolean>;

/** 印が 1 つも無い行 */
export const NO_MARKS: PermissionMarks = {
  productView: false,
  productEdit: false,
  compositionView: false,
  compositionEdit: false,
  substanceView: false,
  substanceEdit: false,
};

/** 6 つ全部に印がある行（新しく作った管理グループの自分の行の初期値。画面設計 3-2） */
export const ALL_MARKS: PermissionMarks = {
  productView: true,
  productEdit: true,
  compositionView: true,
  compositionEdit: true,
  substanceView: true,
  substanceEdit: true,
};

/**
 * その印を付けると自動で付く印（仕様 6-2）。
 * 編集 → 同じ種類の参照。組成 参照 → 製品・原材料 参照。
 * **組成 参照を付けても物質 参照は付かない**（11-06 決定。画面に注意書きを出す）
 */
const MARK_IMPLIES: Partial<Record<PermissionMark, readonly PermissionMark[]>> = {
  productEdit: ["productView"],
  compositionEdit: ["compositionView"],
  compositionView: ["productView"],
  substanceEdit: ["substanceView"],
};

/** 連動を補った印（付いている印から、自動で付く印をたどって足す） */
export function linkMarks(marks: PermissionMarks): PermissionMarks {
  const out = { ...marks };
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of PERMISSION_MARKS) {
      if (!out[k]) continue;
      for (const implied of MARK_IMPLIES[k] ?? []) {
        if (!out[implied]) {
          out[implied] = true;
          changed = true;
        }
      }
    }
  }
  return out;
}

/** その印に連動して自動で付いている印か（自分で付けた印から導ける） */
export function impliedMarks(manual: PermissionMarks): Set<PermissionMark> {
  const linked = linkMarks(manual);
  return new Set(PERMISSION_MARKS.filter((k) => linked[k] && !manual[k]));
}

/**
 * 印を外したとき一緒に外れる印（その印を前提にしている印）。
 * 参照を外すと編集も外れる。製品・原材料 参照を外すと組成も外れる
 */
export function dependentMarks(target: PermissionMark): PermissionMark[] {
  const found = new Set<PermissionMark>();
  const stack: PermissionMark[] = [target];
  while (stack.length > 0) {
    const cur = stack.pop() as PermissionMark;
    for (const k of PERMISSION_MARKS) {
      if (!found.has(k) && (MARK_IMPLIES[k] ?? []).includes(cur)) {
        found.add(k);
        stack.push(k);
      }
    }
  }
  return PERMISSION_MARKS.filter((k) => found.has(k));
}

/** 印が 1 つでもあるか（印が全部外れた行は残さない） */
export function hasAnyMark(marks: PermissionMarks): boolean {
  return PERMISSION_MARKS.some((k) => marks[k]);
}

/**
 * 組成 参照があるのに物質 参照が無い（画面の注意書きを出す条件。仕様 6-2）
 */
export function lacksSubstanceForComposition(marks: PermissionMarks): boolean {
  return marks.compositionView && !marks.substanceView;
}

/** 管理グループの登録・編集の入力（S31 画面設計 3 章） */
export const permissionGroupSchema = (m: Messages) =>
  z.object({
    code: z.string().trim().min(1, m.validation.required).max(64, m.validation.tooLong(64)),
    nameJa: z.string().trim().min(1, m.validation.required).max(100, m.validation.tooLong(100)),
    nameEn: z
      .string()
      .trim()
      .max(100, m.validation.tooLong(100))
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .optional(),
    /** 表の行（相手の管理グループごとの 6 つの印）。連動はサーバーでも補う */
    rows: z
      .array(
        z.object({
          targetGroupId: z.string().trim().min(1),
          productView: z.boolean(),
          productEdit: z.boolean(),
          compositionView: z.boolean(),
          compositionEdit: z.boolean(),
          substanceView: z.boolean(),
          substanceEdit: z.boolean(),
        }),
      )
      .max(1000),
    /** 表とは別の権限 */
    permissions: z.array(z.enum(PERMISSIONS)),
  });
export type PermissionGroupInput = z.infer<ReturnType<typeof permissionGroupSchema>>;

/** 新しく作る管理グループの「自分」の行を指す仮の id（作った後に本当の id へ差し替える） */
export const PERMISSION_GROUP_SELF = "__self";
