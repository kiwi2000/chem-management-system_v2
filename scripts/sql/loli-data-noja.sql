-- scripts/sql/loli-data.sql の、日本語訳なし版。
-- コンパクト版（ListData_Translation）が無いデータベース（2026Q2 など）で使う。
--   {LIST_IDS}  一覧IDをカンマ区切りで
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
SELECT d.ListID, d.Cas,
  CAST(REPLACE(REPLACE(REPLACE(d.Data, CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' ') AS nvarchar(4000)) AS data,
  CAST(NULL AS nvarchar(10)) AS ja
FROM ListData d
WHERE d.ListID IN ({LIST_IDS}) AND d.Data IS NOT NULL AND d.Data <> ''
ORDER BY d.ListID, d.Cas;
