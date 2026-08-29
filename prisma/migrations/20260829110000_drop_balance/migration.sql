-- 「残部」の行をやめる。
--
-- 残部の行は含有率を持たず、100% との差から出していた。消す前にその値を書き込む。
--
-- **先に検査の決まりを外す。**`composition_lines_pct_by_balance` が
-- 「残部の行は含有率を持たない」を強いているので、値を入れようとすると弾かれる
-- （これを外さずに流して、本番のデプロイが止まった）。
--
-- **列がもう無ければ何もしない。**手元では先に消してあるため。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'composition_lines' AND column_name = 'is_balance'
  ) THEN
    ALTER TABLE "composition_lines" DROP CONSTRAINT IF EXISTS "composition_lines_pct_by_balance";

    UPDATE "composition_lines" AS b
    SET "content_pct" = rest.pct, "is_balance" = false
    FROM (
      SELECT b2.id,
             NULLIF(
               GREATEST(
                 100 - COALESCE((
                   SELECT SUM(o."content_pct")
                   FROM "composition_lines" AS o
                   WHERE o."parent_product_id" = b2."parent_product_id"
                     AND o."is_balance" = false
                 ), 0),
                 0),
               0) AS pct
      FROM "composition_lines" AS b2
      WHERE b2."is_balance" = true
    ) AS rest
    WHERE b.id = rest.id;

    ALTER TABLE "composition_lines" DROP COLUMN "is_balance";
  END IF;
END $$;

-- 検査の決まりを入れ直す。**残部が無くなったので、条件分けも要らない。**
-- 含有率が空なのは「入れていない」状態（合計が100%に届かない側で伝わる）
ALTER TABLE "composition_lines" DROP CONSTRAINT IF EXISTS "composition_lines_pct_range";
ALTER TABLE "composition_lines"
  ADD CONSTRAINT "composition_lines_pct_range"
  CHECK ("content_pct" IS NULL OR ("content_pct" > 0 AND "content_pct" <= 100));
