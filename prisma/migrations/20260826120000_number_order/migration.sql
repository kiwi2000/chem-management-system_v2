-- 物質に出す番号の並び順。
--
-- どの番号を出すかは number_label（呼び名）が入っているかどうかで決まるが、
-- **並び順は法令の並びとは別に決めたい。**
-- 実務でよく引く番号（化審法番号・EC番号・TSCA番号など）を上に置くため。
--
-- 出さない区分では使わない。既定は 0 で、同じ値のときは法令 → 区分の順に落ちる。
ALTER TABLE "regulation_categories"
  ADD COLUMN "number_order" INTEGER NOT NULL DEFAULT 0;
