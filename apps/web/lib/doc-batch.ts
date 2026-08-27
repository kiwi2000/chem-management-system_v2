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

export function batchHref(templateId: string, ids: string[]): string {
  return `/documents/${templateId}/batch?ids=${ids.slice(0, BATCH_MAX).join(",")}`;
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
