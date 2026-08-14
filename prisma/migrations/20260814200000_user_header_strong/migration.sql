-- 「ヘッダーなどを濃くする」の入切を利用者ごとに持つ
ALTER TABLE "users" ADD COLUMN "preferred_header_strong" BOOLEAN;

-- 廃止したテーマ（ネイビー / ティール / ワイン / チャコール）を選んでいた人は、
-- 近い配色 ＋「ヘッダーを濃くする」入 へ読み替える。見た目が変わらないようにするため。
UPDATE "users" SET "preferred_theme" = 'sky',   "preferred_header_strong" = TRUE WHERE "preferred_theme" = 'navy';
UPDATE "users" SET "preferred_theme" = 'ocean', "preferred_header_strong" = TRUE WHERE "preferred_theme" = 'teal';
UPDATE "users" SET "preferred_theme" = 'rose',  "preferred_header_strong" = TRUE WHERE "preferred_theme" = 'wine';
UPDATE "users" SET "preferred_theme" = 'light', "preferred_header_strong" = TRUE WHERE "preferred_theme" = 'charcoal';
