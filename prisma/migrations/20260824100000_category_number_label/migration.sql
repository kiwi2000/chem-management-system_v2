-- 番号のリストとしての区分。
-- 官報公示整理番号・EC番号などは、あるインベントリが振っている番号であって
-- 物質そのものの属性ではない。番号体系ごとに区分を立て、番号は法文物質名の
-- official_number に入れる。この列は「その区分が番号のリストかどうか」の印と、
-- 物質の画面に出すときの呼び名を兼ねる（空なら番号のリストではない）。
ALTER TABLE "regulation_categories" ADD COLUMN "number_label" TEXT;

-- 物質の画面は「呼び名の入っている区分」を横断して引くので、そこだけ拾える索引を張る
CREATE INDEX "regulation_categories_number_label_idx"
  ON "regulation_categories" ("number_label")
  WHERE "number_label" IS NOT NULL;
