/**
 * 組成を保存したあと、同じ画面の「法規制判定」に読み直させる合図。
 *
 * 組成を保存すると、サーバー側で展開結果と判定を作り直している
 * （`lib/expansion-store.ts` の `recomputeFrom`）。
 * 上の「原材料展開・CAS合算」と下の「法規制判定」は別々に読み込んでいるので、
 * 伝えないと判定のほうだけ古いまま残り、同じ画面で食い違う（2026-09-19 報告）。
 *
 * 枠の親子が離れている（判定は `ProductForm` の中に差し込んでいる）ため、
 * props を通すのではなく画面ごとの合図にする
 */
export const JUDGEMENTS_CHANGED = "chem:judgements-changed";

/** 判定を作り直したことを、同じ画面の枠に知らせる */
export function notifyJudgementsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(JUDGEMENTS_CHANGED));
}
