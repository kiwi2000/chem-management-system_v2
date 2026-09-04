-- フィードバックの種別に「ToDo」「アイデア」を足す。
-- 既存の値は変えない。並び（不具合 / 要望 / 質問 / ToDo / アイデア / その他）は画面側の配列で決める
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'TODO';
ALTER TYPE "FeedbackKind" ADD VALUE IF NOT EXISTS 'IDEA';
