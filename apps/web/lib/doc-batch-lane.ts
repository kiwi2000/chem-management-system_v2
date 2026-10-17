/**
 * 帳票を作る仕事の待ち行列の「車線」。
 *
 * 1 件だけ出したい人を、何百件もまとめて作る仕事の後ろで待たせない（2026-10-17 指示）。
 * 待ち行列は 2 本。**小さい仕事（SMALL_JOB_UNITS 枚以下）と大きい仕事で分け、それぞれ順に 1 つずつ走る。**
 * 2 本が同時に動くので、PDF 作成は最大 2 件まで同時になる（サーバーの CPU はそれで足りる）。
 * 同じ車線の中は今までどおり先着順
 */
export const SMALL_JOB_UNITS = 5;

export type LaneName = "small" | "large";

/** 作る枚数から車線を決める */
export function laneFor(total: number): LaneName {
  return total <= SMALL_JOB_UNITS ? "small" : "large";
}
