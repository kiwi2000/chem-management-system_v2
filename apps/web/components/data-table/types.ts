import type { ColumnKind } from "@chem/shared";
import type { ReactNode } from "react";

/** 一覧に出す列の定義。サーバー側の QueryColumn とキーを合わせること */
export interface TableColumn<T> {
  key: string;
  header: string;
  kind: ColumnKind;
  /** 表示。省略すると何も出さない（操作列などに使う） */
  render?: (row: T) => ReactNode;
  /** enum 列の選択肢 */
  options?: { value: string; label: string }[];
  sortable?: boolean;
  filterable?: boolean;
  /** 既定の列幅（px）。利用者がドラッグで変えた幅は端末に記憶される */
  width?: number;
  /** 1セルに複数行を出す（省略記号で切らず、行の高さを伸ばす） */
  multiline?: boolean;
  /** セルに付けるクラス（等幅フォントなど） */
  className?: string;
}

export const DEFAULT_COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 48;
/** 操作列（アイコンボタン）の既定幅 */
export const ACTIONS_COLUMN_WIDTH = 84;
