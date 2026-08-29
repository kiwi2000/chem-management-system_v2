-- データソースの印に出す文字。決めていなければコードの頭文字を使う。
-- 頭文字はぶつかる（CHRIP と CFR）ので、短い語も入れられるようにする。
ALTER TABLE "sources" ADD COLUMN "mark" VARCHAR(8);
