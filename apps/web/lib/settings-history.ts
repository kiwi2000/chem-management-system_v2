import { DEFAULT_SETTINGS, SETTING_DEFS } from "@chem/shared";

/**
 * システム設定の保存の記録から、「何を変えたか」を出す（アクセス記録に出す。2026-11-17 利用者の指示）。
 *
 * 保存の記録には、保存したあとの全部の値が入っている。1 つ前の保存と見比べて、違う項目だけを取り出す。
 * 1 つ前の記録に無い項目（あとから足した設定）と、最初の保存は、最初の値（`DEFAULT_SETTINGS`）と比べる
 */
export interface SettingChange {
  field: string;
  /** 入・切か、数か、それ以外（文字・一覧）か。画面は、入切と数だけ値を出す */
  kind: "bool" | "number" | "other";
  from: boolean | number | null;
  to: boolean | number | null;
}

const FIELDS = SETTING_DEFS.map((d) => d.field as string);

export function settingChanges(prev: unknown, cur: unknown): SettingChange[] {
  const before = (prev ?? {}) as Record<string, unknown>;
  const after = (cur ?? {}) as Record<string, unknown>;
  const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const out: SettingChange[] = [];
  for (const field of FIELDS) {
    // その保存に入っていない項目（まだ無かった設定）は、変えたことにしない
    if (!(field in after)) continue;
    const was = field in before ? before[field] : defaults[field];
    const now = after[field];
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    if (typeof now === "boolean") {
      out.push({ field, kind: "bool", from: typeof was === "boolean" ? was : null, to: now });
    } else if (typeof now === "number") {
      out.push({ field, kind: "number", from: typeof was === "number" ? was : null, to: now });
    } else {
      out.push({ field, kind: "other", from: null, to: null });
    }
  }
  return out;
}

/**
 * 保存の記録を古い順に並べたものから、記録ごとの「1 つ前の保存」を引く。
 * 同じ時刻の記録が続いても、並びの順（古い順）で決める
 */
export function previousOf<T extends { id: string }>(ordered: T[]): Map<string, T | null> {
  const map = new Map<string, T | null>();
  ordered.forEach((row, i) => map.set(row.id, i > 0 ? (ordered[i - 1] ?? null) : null));
  return map;
}
