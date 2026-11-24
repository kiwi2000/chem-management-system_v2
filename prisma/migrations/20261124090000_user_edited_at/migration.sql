-- 管理者が直す中身（表示名・有効・所属・管理グループ）を最後に変えた時刻（2026-11-24）。
-- ユーザーの編集と削除の楽観的ロックの印に使う。updated_at はログインや個人設定でも進むため、印に使えない。
-- いまの行は、これまでの更新時刻から始める
ALTER TABLE "users" ADD COLUMN "edited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "users" SET "edited_at" = "updated_at";
