-- 「換算先」に名前を直す。金属とは限らない（無機シアン化合物はシアン CN として換算する）。

ALTER TABLE "regulation_categories" RENAME COLUMN "aggregation_element" TO "conversion_target";
ALTER TABLE "statutory_substances" RENAME COLUMN "aggregation_element" TO "conversion_target";
