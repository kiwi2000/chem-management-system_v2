/**
 * 法規制データの写し（スナップショット）。
 *
 * 写しを取る処理は apps/web/lib/import/snapshot.ts に移した（データ入出力の「エクスポート」と
 * 同じものを使う。決定 0011）。ここは以前どおりの名前で呼べるようにする薄皮
 */
export { SNAPSHOT_FORMAT } from "@chem/shared";
export type {
  CategorySnap,
  ClassSnap,
  LawSnap,
  LinkSnap,
  Snapshot,
  SubstanceSnap,
} from "@chem/shared";
export { takeSnapshot } from "../../../apps/web/lib/import/snapshot";
