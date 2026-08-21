"use client";

/**
 * 保存に失敗したとき、どの項目が悪いのかを画面に出すための橋渡し。
 *
 * サーバーは Zod の `flatten()` を `error.details` に載せて返す。
 * 形は { formErrors: string[], fieldErrors: { 項目名: string[] } }。
 * 子テーブル（別名・官報番号など）の誤りは、親の項目名にまとめられて届く。
 */
export type FieldErrors = Record<string, string[]>;

interface Flattened {
  formErrors?: unknown;
  fieldErrors?: unknown;
}

/** API の details から項目別の誤りを取り出す。読めない形なら空にする */
export function toFieldErrors(details: unknown): FieldErrors {
  if (typeof details !== "object" || details === null) return {};
  const raw = (details as Flattened).fieldErrors;
  if (typeof raw !== "object" || raw === null) return {};

  const out: FieldErrors = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const messages = value.filter((v): v is string => typeof v === "string" && v !== "");
    if (messages.length > 0) out[key] = messages;
  }
  return out;
}

/** 項目名を渡すと、最初の誤りを返す（無ければ undefined） */
export function firstError(errors: FieldErrors, key: string): string | undefined {
  return errors[key]?.[0];
}

/**
 * まとめて上に出す文。
 * 項目ごとに出せない誤り（対応する欄が無いものなど）も、ここに並べて理由が分かるようにする。
 * 何も取れなかったときだけ、汎用の文に落とす。
 */
export function summaryError(details: unknown, fallback: string): string {
  const byField = toFieldErrors(details);
  const messages = Object.values(byField).flat();
  if (typeof details === "object" && details !== null) {
    const form = (details as Flattened).formErrors;
    if (Array.isArray(form))
      messages.push(...form.filter((v): v is string => typeof v === "string" && v !== ""));
  }
  const uniq = [...new Set(messages)];
  return uniq.length > 0 ? uniq.join(" / ") : fallback;
}
