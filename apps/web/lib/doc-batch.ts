/**
 * 帳票を 1 件作るときの行き先。
 *
 * まとめて作るときは URL ではなく、バックグラウンド処理の仕事（`/api/documents/batch`）に頼む
 * （2026-09-16。以前は選んだ ID を URL に載せて 100 件までに限っていた）。
 */

/**
 * 帳票の相手。**URL で持ち回る。**
 * 対象を選ぶ画面をまたぐので、選んだ差出人・宛先を落とさないため
 */
export interface PartyParams {
  /** 任意の会社・任意の部署（組織のID）。様式がその項目を使っているときだけ付く */
  company?: string | null;
  department?: string | null;
  /** 宛先の組織 */
  to?: string | null;
  /** 組織ブロックで選んだ組織。`<ブロックid>:<組織id>` の並び */
  org?: string[];
}

/** 差出人・宛先を問い合わせ文字列に足す（無いものは付けない） */
export function partyQuery(q: URLSearchParams, parties?: PartyParams): URLSearchParams {
  if (parties?.company) q.set("company", parties.company);
  if (parties?.department) q.set("department", parties.department);
  if (parties?.to) q.set("to", parties.to);
  for (const v of parties?.org ?? []) q.append("org", v);
  return q;
}

/** 1件ぶんの行き先 */
export function documentHref(templateId: string, targetId: string, parties?: PartyParams): string {
  const q = partyQuery(new URLSearchParams(), parties);
  const tail = q.toString();
  return `/documents/${templateId}/${targetId}${tail ? `?${tail}` : ""}`;
}

/**
 * 相手の選びかた（画面 → 仕事）。
 * ID の並びか、「絞り込みに当たる全件」（一覧の問い合わせ文字列で持ち、走るときに引き直す）
 */
export type DocPickSelection =
  { mode: "ids"; ids: string[] } | { mode: "all"; filter: string; total: number };
