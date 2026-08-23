-- 化学物質の名称は、思っているより長い。
-- 安衛法の一覧には、日本語で522文字・英語で626文字の名称が実在する（マクロライド系など）。
-- 500文字では入らないので、名称の3列を上限なしにする。
ALTER TABLE "laws"
  ALTER COLUMN "name_original" TYPE TEXT,
  ALTER COLUMN "name_ja" TYPE TEXT,
  ALTER COLUMN "name_en" TYPE TEXT;

ALTER TABLE "regulation_categories"
  ALTER COLUMN "name_original" TYPE TEXT,
  ALTER COLUMN "name_ja" TYPE TEXT,
  ALTER COLUMN "name_en" TYPE TEXT;

ALTER TABLE "regulation_classes"
  ALTER COLUMN "name_original" TYPE TEXT,
  ALTER COLUMN "name_ja" TYPE TEXT,
  ALTER COLUMN "name_en" TYPE TEXT;

ALTER TABLE "statutory_substances"
  ALTER COLUMN "name_original" TYPE TEXT,
  ALTER COLUMN "name_ja" TYPE TEXT,
  ALTER COLUMN "name_en" TYPE TEXT;

-- 名称の索引は外す。
-- 上限を外すと、長い名称が btree の上限（約2704バイト）に当たって登録できなくなる。
-- そもそも絞り込みは「を含む」（前後一致）なので、この索引は効いていなかった。
DROP INDEX "statutory_substances_name_ja_idx";
DROP INDEX "statutory_substances_name_en_idx";
