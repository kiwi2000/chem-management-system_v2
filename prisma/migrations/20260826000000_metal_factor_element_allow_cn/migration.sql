-- 換算先に「CN」（シアン）を書けるようにする。
--
-- 化管法の「無機シアン化合物」は**シアンとして**数えると決めてある
-- （docs/judgment-engine.md）。元素マスタ（elements.symbol）は
-- はじめから 2文字目以降に大文字を許してあったが、こちらだけ
-- 「大文字＋小文字」に限っていたため、CN が入らなかった。
--
-- 元素マスタと同じ形にそろえる。
ALTER TABLE "metal_conversion_factors"
  DROP CONSTRAINT "metal_conversion_factors_element_format";

ALTER TABLE "metal_conversion_factors"
  ADD CONSTRAINT "metal_conversion_factors_element_format"
  CHECK ("metal_element" ~ '^[A-Z][A-Za-z]{0,2}$');
