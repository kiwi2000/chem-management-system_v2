-- LOLI の ListData.Data（一覧ごとの、CAS についての文章）を取り出す。
--
-- 1行 = 1一覧 × 1CAS。`Data` は表示用に文章化したもので、
-- 「>= 0.3 wt% cut-off value (Attached table, 2-1437, [Toluene])」のように
-- 閾値・出典・親の総称までを1本の文字列にしてある。突合には使わない（XML を使う）が、
-- **人が読む説明としてリンクに添える**ために取る。
--
--   {LIST_IDS}  一覧IDをカンマ区切りで
--   {COMPACT}   コンパクト版のデータベース名（日本語訳の出どころ）
--
-- 日本語訳はコンパクト版の ListData_Translation（LangID=21）にある。
-- 展開版では総称（RR 番号）や親の CAS が個々の CAS に開かれていて、その行の Data の末尾に
-- `As Toluene [108-88-3]` / `As Nitrites [RR-14244-9]` のように親の番号が付く。
-- 訳はコンパクト版の親の行にしか無いので、**同じ CAS の訳が無ければ、末尾の角括弧の番号で引く。**
-- 角括弧の中が番号でなければ何にも当たらず、訳は空になるだけ。
-- タブ・改行は欄の区切りと衝突するので空白に潰す。長さは nvarchar(4000) に揃える
-- （sqlcmd の -W と -y は併用できない）。
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT d.ListID, d.Cas,
  CAST(REPLACE(REPLACE(REPLACE(d.Data, CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' ') AS nvarchar(4000)) AS data,
  CAST(REPLACE(REPLACE(REPLACE(j.Data, CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' ') AS nvarchar(4000)) AS ja
FROM ListData d
OUTER APPLY (
  SELECT TOP 1 t.Data
  FROM [{COMPACT}].dbo.ListData_Translation t
  WHERE t.ListID = d.ListID AND t.LangID = 21
    AND (t.Cas = d.Cas OR t.Cas = CASE WHEN d.Data LIKE '%]' THEN SUBSTRING(d.Data, LEN(d.Data) - CHARINDEX('[', REVERSE(d.Data)) + 2, CHARINDEX('[', REVERSE(d.Data)) - 2) END)
  ORDER BY CASE WHEN t.Cas = d.Cas THEN 0 ELSE 1 END
) j
WHERE d.ListID IN ({LIST_IDS}) AND d.Data IS NOT NULL AND d.Data <> ''
ORDER BY d.ListID, d.Cas;
