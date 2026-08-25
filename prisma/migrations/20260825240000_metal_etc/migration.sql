-- 「金属等」に名前を直す。現場の呼び名が「金属換算」のため。
-- 中身は金属とは限らない（無機シアン化合物はシアン CN として数える）。

ALTER TABLE "regulation_categories" RENAME COLUMN "aggregation_element" TO "metal_etc";
ALTER TABLE "statutory_substances" RENAME COLUMN "aggregation_element" TO "metal_etc";
