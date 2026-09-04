/**
 * 「全製品の判定をやり直す必要があるか」の判断。
 *
 * 法規制側のデータ（対象CAS・閾値・法文物質名・規制区分）を変えても、
 * 判定は自動ではやり直されない。管理者がボタンを押すまで、古い判定が残る。
 * その「押すべき状態」を、どの画面にいても分かるように左メニューの下へ出す。
 *
 * DB を読む部分（rejudge-job.ts）と分け、判断そのものはここで試験する
 */
export interface RejudgeNeededInput {
  /** 現在の法規制バージョン。無ければ判定のしようがない */
  currentVersionId: string | null;
  /** 法規制側のデータが最後に変わった時刻。データが無ければ null */
  changedAt: Date | null;
  /** 最後に全製品を判定し直し終えた時刻と、そのときのバージョン */
  lastFull: { at: Date; versionId: string | null } | null;
}

export function isRejudgeNeeded({ currentVersionId, changedAt, lastFull }: RejudgeNeededInput) {
  if (!currentVersionId) return false;
  // 判定し直した記録が無い＝比べようがない。製品も判定も無い新しい環境で騒がない
  if (!lastFull) return false;
  // 別のバージョンで判定したまま切り替えた
  if (lastFull.versionId !== null && lastFull.versionId !== currentVersionId) return true;
  if (!changedAt) return false;
  return changedAt.getTime() > lastFull.at.getTime();
}
