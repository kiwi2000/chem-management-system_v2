-- インベントリは**加工してから取り込む**。
--
-- 元は LOLI の Data をそのまま持ち、番号の取り出しを画面側の正規表現で行う形だった。
-- やめた理由は2つ。
--
--   1. 取り出しは**取り込みのときに1回で済む**。画面を開くたびに正規表現を当てる必要はない
--   2. 正規表現の設定を画面に置くと、**システムの中に取り込みの都合が入り込む**。
--      インベントリは他の法規制とは別に取り込むものなので、加工も取り込み側に置く
--
-- そのため、行が持つのは**仕上がった値**（番号、または「該当」のような文字）だけ。
-- 1行から複数の番号が取れる名簿（EINECS・KECI）では、番号の数だけ行ができる。

ALTER TABLE "inventory_rows" RENAME COLUMN "data" TO "value";

-- 取り出しかた（正規表現）は取り込みスクリプトが持つ。画面では使わない
ALTER TABLE "inventories" DROP COLUMN "match_pattern";
ALTER TABLE "inventories" DROP COLUMN "display_format";

-- 同じ物質に同じ値が2回出ることはない。取り込み直しの取りこぼしにも気づける
CREATE UNIQUE INDEX "inventory_rows_inventory_cas_value_key"
  ON "inventory_rows"("inventory_id", "cas_normalized", "value");
