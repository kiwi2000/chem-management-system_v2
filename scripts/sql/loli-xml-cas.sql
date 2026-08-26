-- LOLI の ListData.XML から「鍵とCAS」を取り出す。
--
-- `Data` 欄は表示用に文章化したもので、**番号が落ちている一覧がある**。
-- 元の欄別データは XML 欄にある（Datafeed 説明書 4.13 ListData）。
-- 欄の意味は一覧ごとに ListNames_Control.XML_Admin / XML_XSD で定義されている。
--
--   {LIST_ID}  一覧ID
--   {KEYEXPR}  鍵を作る式。row を r として `r.value('(code)[1]','varchar(200)')` のように書く
--   {FILTER}   絞り込み。要らなければ空。row の中の欄で絞れる
--
-- 1行 = 1鍵 × 1CAS。1つのCASが同じ一覧の複数の号に載ることがあるので、row 単位で開く。
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT k, cas FROM (
  SELECT LTRIM(RTRIM({KEYEXPR})) AS k, d.Cas AS cas
  FROM ListData d
  CROSS APPLY (SELECT CAST(d.XML AS xml)) x(px)
  CROSS APPLY x.px.nodes('/root/row') t(r)
  WHERE d.ListID = {LIST_ID} {FILTER}
) z
WHERE k IS NOT NULL AND k <> ''
ORDER BY k, cas;
