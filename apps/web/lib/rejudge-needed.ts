/**
 * 「全製品の判定をやり直す必要があるか」の判断。
 *
 * 法規制側のデータ（対象CAS・閾値・法文物質名・規制区分）を変えても、
 * 判定は自動ではやり直されない。管理者がボタンを押すまで、古い判定が残る。
 * その「押すべき状態」を、どの画面にいても分かるように左メニューの下へ出す。
 *
 * DB を読む部分（rejudge-job.ts）と分け、判断そのものはここで試験する。
 *
 * 判定は判定対象日を持つ（2026-09-22 決定）。日が経って、法文物質名や区分の
 * 施行日・適用終了日を跨いだ判定は、前提が変わっていなくても古い（`boundaryCrossed`）
 */
export interface RejudgeNeededInput {
  /** 現在の法規制バージョン。無ければ判定のしようがない */
  currentVersionId: string | null;
  /** 法規制側のデータが最後に変わった時刻。データが無ければ null */
  changedAt: Date | null;
  /**
   * 現在のバージョンで最後に全製品を判定し直し終えた時刻。
   * 記録が無ければ、その版の判定のうちいちばん古い計算日時。その版の判定が無ければ null
   */
  lastFull: Date | null;
  /**
   * 別の版では判定してあるのに、現在の版の判定が無い製品があるか。
   * 判定は版ごとに持つので、切り替えただけではその版の判定は作られない（2026-09-12 決定）
   */
  missing: boolean;
  /**
   * 判定対象日から今日までのあいだに、施行日・適用終了日を跨いだ法文物質名・区分で
   * 判定した製品があるか（判定に付けた「効いている」印が、今日で見ると変わる）。省くと無い
   */
  boundaryCrossed?: boolean;
}

export function isRejudgeNeeded({
  currentVersionId,
  changedAt,
  lastFull,
  missing,
  boundaryCrossed = false,
}: RejudgeNeededInput) {
  if (!currentVersionId) return false;
  // 切り替えたまま、この版の判定を作っていない製品がある
  if (missing) return true;
  // 施行日・適用終了日を過ぎた法文物質名がある。データは変わっていなくても判定は古い
  if (boundaryCrossed) return true;
  // 判定し直した記録が無い＝比べようがない。製品も判定も無い新しい環境で騒がない
  if (!lastFull) return false;
  if (!changedAt) return false;
  return changedAt.getTime() > lastFull.getTime();
}
