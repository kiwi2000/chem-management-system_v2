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
  /** セルに付けるクラス（幅・等幅フォントなど） */
  className?: string;
  headerClassName?: string;
}
