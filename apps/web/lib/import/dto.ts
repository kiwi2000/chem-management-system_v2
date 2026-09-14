import type { ImportAction, ImportKind, ImportStatus } from "@prisma/client";
import type { ApplySummary, Diff } from "@/lib/import/types";

/** 画面とやり取りする形（API の応答）。サーバー側の型から、画面に要るものだけ */

export type { ImportAction, ImportKind, ImportStatus };

export interface ImportJobDto {
  id: string;
  kind: ImportKind;
  status: ImportStatus;
  fileName: string;
  fileSize: number;
  summary: ImportSummaryDto | null;
  error: string | null;
  progress: number;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  stagedAt: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  appliedByName?: string | null;
  /** 詳細だけ */
  running?: boolean;
  counts?: { kind: string; action: ImportAction; apply: boolean; count: number }[];
}

/** アップロード直後は kind / fileName / rows / header、読み取り後は counts / errors / notes、反映後は apply が足される */
export interface ImportSummaryDto {
  kind: string;
  fileName: string;
  rows: number | null;
  header?: string[] | null;
  counts?: Record<string, Partial<Record<ImportAction, number>>>;
  errors?: number;
  notes?: string[];
  apply?: ApplySummary;
}

export interface ImportRowDto {
  id: string;
  seq: number;
  kind: string;
  keyPath: string;
  label: string;
  action: ImportAction;
  apply: boolean;
  diff: Diff | null;
  message: string | null;
}
