import type { DocumentTable, DocumentTarget } from "@chem/shared";

/** 預かったファイルに値を埋めるときの入れもの。`DocData` をそのまま流せる形にする */
export interface FillInput {
  file: Buffer;
  target: DocumentTarget;
  values: Map<string, string>;
  tables: Map<
    DocumentTable,
    { columns: { key: string; label: string }[]; rows: Record<string, string>[] }
  >;
  /** 組織に打たれている項目名。これに無い `org.item.◯◯` は知らない札として数える */
  orgItems?: string[];
}

export interface FillResult {
  buffer: Buffer;
  /** 分からなかった札。画面で知らせる */
  unknown: string[];
}
