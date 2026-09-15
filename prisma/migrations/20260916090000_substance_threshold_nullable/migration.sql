-- 法文物質名の閾値を空にできるようにする。空の欄は区分の閾値に従う（区分の閾値が既定値）。
-- いま区分と同じ値が入っている欄は「区分に従う」の意味なので空にする（判定の結果は変わらない）
ALTER TABLE "statutory_substances"
  ALTER COLUMN "threshold_lower" DROP NOT NULL,
  ALTER COLUMN "lower_bound" DROP NOT NULL,
  ALTER COLUMN "threshold_upper" DROP NOT NULL,
  ALTER COLUMN "upper_bound" DROP NOT NULL;

UPDATE "statutory_substances" s
SET "threshold_lower" = NULL
FROM "regulation_classes" k
JOIN "regulation_categories" c ON c."id" = k."category_id"
WHERE s."class_id" = k."id" AND s."threshold_lower" = c."threshold_lower";

UPDATE "statutory_substances" s
SET "lower_bound" = NULL
FROM "regulation_classes" k
JOIN "regulation_categories" c ON c."id" = k."category_id"
WHERE s."class_id" = k."id" AND s."lower_bound" = c."lower_bound";

UPDATE "statutory_substances" s
SET "threshold_upper" = NULL
FROM "regulation_classes" k
JOIN "regulation_categories" c ON c."id" = k."category_id"
WHERE s."class_id" = k."id" AND s."threshold_upper" = c."threshold_upper";

UPDATE "statutory_substances" s
SET "upper_bound" = NULL
FROM "regulation_classes" k
JOIN "regulation_categories" c ON c."id" = k."category_id"
WHERE s."class_id" = k."id" AND s."upper_bound" = c."upper_bound";
