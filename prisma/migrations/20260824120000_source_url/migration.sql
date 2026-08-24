-- 情報源の参照先。LOLI や CHRIP の案内ページなど。
-- 「どこから買ったデータか」を画面から辿れるようにするためのもの。
ALTER TABLE "sources" ADD COLUMN "url" TEXT;
