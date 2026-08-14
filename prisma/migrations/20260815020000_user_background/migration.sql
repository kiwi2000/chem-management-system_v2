-- 背景の模様・挿絵を利用者ごとに持つ
ALTER TABLE "users" ADD COLUMN "preferred_background" TEXT;
