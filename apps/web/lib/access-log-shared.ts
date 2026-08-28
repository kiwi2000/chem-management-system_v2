import { Prisma } from "@prisma/client";
import type { ColumnFilter } from "@chem/shared";
import type { QueryColumn } from "@/lib/table-query";

/** 入口の出来事 */
export const SIGNIN_ACTIONS = [
  "login",
  "login_failed",
  "logout",
  /*
    2要素認証の付け外し。入口の守りが変わった瞬間なので、ログインと同じ並びに出す。
    **身に覚えのない登録に気づくための行。**別の画面に隠すと誰も見ない
  */
  "mfa_enable",
  "mfa_disable",
  "passkey_add",
  "passkey_remove",
];

/** データが外へ出る出来事。出力・取込みを作ったらここに並ぶ */
export const TAKEOUT_ACTIONS = ["view", "export", "import"];

/**
 * アクセス記録の一覧で絞れるもの。
 * 対象や利用者の「名前」は別の表にあるので、ここでは絞り込めない
 * （監査ログは関連を張らず、あとから組み立てて見せる作りにしてある）。
 */
export const ACCESS_LOG_COLUMNS: QueryColumn[] = [
  { key: "at", kind: "date", field: "at" },
  { key: "action", kind: "enum", field: "action" },
  { key: "actorId", kind: "enum", field: "actorId" },
  /*
    接続元と使った機械は、記録の中（`diff`）に入っている。
    列として持っていないので、JSON をたどって絞る。

    **場所（国）は絞れない。**IPから読んでいるだけで、記録には残っていないため。
    絞れるように見せると、当たらない条件を打たせることになる
  */
  { key: "ip", kind: "text", field: "diff", custom: (f) => jsonContains("ip", f) },
  { key: "userAgent", kind: "text", field: "diff", custom: (f) => jsonContains("userAgent", f) },
];

/** 記録の中の1つの値を、文字の条件で絞る */
function jsonContains(key: string, f: ColumnFilter): Record<string, unknown> | null {
  if (f.kind !== "text") return null;
  const v = f.value.trim();
  if (f.op === "empty") return { diff: { path: [key], equals: Prisma.DbNull } };
  if (f.op === "notEmpty") return { NOT: { diff: { path: [key], equals: Prisma.DbNull } } };
  if (v === "") return null;
  const at = { path: [key] } as const;
  if (f.op === "equals") return { diff: { ...at, equals: v } };
  if (f.op === "startsWith") return { diff: { ...at, string_starts_with: v } };
  if (f.op === "endsWith") return { diff: { ...at, string_ends_with: v } };
  return { diff: { ...at, string_contains: v } };
}
