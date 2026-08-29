-- 「残部」の行をやめる。
-- 残部の行は含有率を持たず、100% との差から出していた。
-- **消す前に、その値を含有率として書き込んである**（scripts/fix-balance-lines.ts）。
-- 残っているものがあれば、ここで同じ計算をして埋める。
UPDATE "composition_lines" AS b
SET "content_pct" = GREATEST(
      100 - COALESCE((
        SELECT SUM(o."content_pct")
        FROM "composition_lines" AS o
        WHERE o."parent_product_id" = b."parent_product_id"
          AND o."is_balance" = false
      ), 0),
      0)
WHERE b."is_balance" = true;

ALTER TABLE "composition_lines" DROP COLUMN "is_balance";
