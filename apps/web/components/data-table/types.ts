import type { ColumnKind } from "@chem/shared";
import type { ReactNode } from "react";

/** 一覧に出す列の定義。サーバー側の QueryColumn とキーを合わせること */
export interface TableColumn<T> {
  key: string;
  header: string;
  kind: ColumnKind;
  /** 表示。省略すると何も出さない（操作列などに使う） */
  render?: (row: T) => ReactNode;
  /**
   * enum 列の選択肢。`color` を付けると、ボタン形の絞り込み（filterAsButtons）で
   * 選んだときにその色で塗る（セッションの状態の緑・黄・赤など）
   */
  options?: { value: string; label: string; color?: string }[];
  /**
   * enum 列の絞り込みを、開閉する一覧ではなく**押すと対象になるボタンの並び**で出す。
   * データソースの選びかた（物質画面）と同じ形。選択肢が少なく、色で見分けたい列に使う
   */
  filterAsButtons?: boolean;
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
  /**
   * kind="list" で打ち込ませる列の、文字の分けかた。
   * numeric（既定）は CAS番号向けで数字とハイフン以外を区切りにする。
   * **名前を打つ列は text にする。**numeric だと文字が全部捨てられて条件にならない
   */
  tokens?: "numeric" | "text";
  /** 表には出さず、フィルターの条件としてだけ使う列（組成のCAS番号など） */
  filterOnly?: boolean;
  /** 既定の列幅（px）。利用者がドラッグで変えた幅は端末に記憶される */
  width?: number;
  /** 1セルに複数行を出す（省略記号で切らず、行の高さを伸ばす） */
  multiline?: boolean;
  /**
   * multiline のとき、何行で打ち切るか。
   * 長い文章がそのまま入ると行の高さがばらばらになり、一覧として読めなくなる。
   * 打ち切った行は末尾が「…」になるので、続きは詳細で読む。
   */
  clampLines?: number;
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

/** 行をつかんで並べ替えるための列。アイコン1つぶん */
export const DRAG_COLUMN_WIDTH = 28;

/** 行の右端に置く操作（編集）の列。アイコン1つぶん */
export const ACTION_COLUMN_WIDTH = 40;

/**
 * 行の高さを1行ぶん伸ばすときの刻み（px）。
 * 一覧の本文（text-sm）の行送りに合わせてある。
 */
export const ROW_LINE_HEIGHT = 20;

/** セルの上下の余白（px）。`TableCell` の `p-2` の上下ぶん */
export const ROW_PADDING = 16;

/**
 * 行の高さの上限（行数）。
 * これ以上高くすると1画面に数行しか入らず、一覧として見る意味が薄くなる。
 * 全部を読むならセルにマウスを置くか、詳細を開く
 */
export const MAX_ROW_LINES = 12;
