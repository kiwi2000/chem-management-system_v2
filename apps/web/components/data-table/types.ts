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
  /**
   * 空になりうる列か。必須の列（製品コードなど）は false にすると
   * 「空白」「空白でない」を出さない（選んでも意味が無いため）。
   */
  nullable?: boolean;
  /**
   * フィルターのパネルで列名を出さない。
   * 選択肢の文言だけで何の列か分かるとき（原材料/原材料以外 など）に使う。
   */
  filterLabelHidden?: boolean;
  /** フィルターの入力欄を、その行いっぱいに広げる（長い名称を打つ列向け） */
  filterFullWidth?: boolean;
  /** フィルターの入力欄に出す入力例 */
  filterPlaceholder?: string;
  /** 表には出さず、フィルターの条件としてだけ使う列（組成のCAS番号など） */
  filterOnly?: boolean;
  /** 既定の列幅（px）。利用者がドラッグで変えた幅は端末に記憶される */
  width?: number;
  /** 1セルに複数行を出す（省略記号で切らず、行の高さを伸ばす） */
  multiline?: boolean;
  /** セルに付けるクラス（等幅フォントなど） */
  className?: string;
}

export const DEFAULT_COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 48;
/**
 * 先頭のチェックボックス列の幅。
 * チェックボックス（約16px）＋左右の余白ぶん。
 * この列だけは他の列のように比率で伸び縮みさせず、常にこの幅で固定する。
 */
export const SELECT_COLUMN_WIDTH = 32;
