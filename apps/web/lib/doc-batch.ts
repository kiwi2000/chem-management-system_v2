/**
 * まとめて帳票を作るときの行き先。
 *
 * **選んだものは URL に載せる。**サーバーに預けると、
 * 印刷し直したり戻ったりするたびに、預けたものが生きているかを気にすることになる。
 * URL に入っていれば、あとから開き直しても同じ帳票が出る。
 *
 * ただし長さには限りがあるので、**入れられる数を決めておく**。
 * 超えたぶんは切らずに、画面で断る（黙って減らすと、
 * 出したはずのものが入っていないことに気づけない）。
 */
export const BATCH_MAX = 100;

/**
 * 帳票の相手。**URL で持ち回る。**
 * 対象を選ぶ画面をまたぐので、選んだ差出人・宛先を落とさないため
 */
export interface PartyParams {
  /** 差出人の組織。既定は作った人の会社 */
  from?: string | null;
  /** 宛先の組織 */
  to?: string | null;
}

/** `from` `to` を問い合わせ文字列に足す（無いものは付けない） */
export function partyQuery(q: URLSearchParams, parties?: PartyParams): URLSearchParams {
  if (parties?.from) q.set("from", parties.from);
  if (parties?.to) q.set("to", parties.to);
  return q;
}

export function batchHref(templateId: string, ids: string[], parties?: PartyParams): string {
  const q = new URLSearchParams({ ids: ids.slice(0, BATCH_MAX).join(",") });
  return `/documents/${templateId}/batch?${partyQuery(q, parties)}`;
}

/** 1件ぶんの行き先 */
export function documentHref(templateId: string, targetId: string, parties?: PartyParams): string {
  const q = partyQuery(new URLSearchParams(), parties);
  const tail = q.toString();
  return `/documents/${templateId}/${targetId}${tail ? `?${tail}` : ""}`;
}

/** URL から取り出す。空や重複は落とす */
export function parseBatchIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ].slice(0, BATCH_MAX);
}
