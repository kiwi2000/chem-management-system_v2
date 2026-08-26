-- CAS番号ごとの物質名（中国の目録ぶん）。物質マスタに登録するために使う。
--
-- 対象の一覧番号だけが cas-names.sql と違う。名前の取り方は同じ。
-- 中国語名は使わない。**この画面の利用者は日本語で読む**ので、
-- 日本語が無ければ英語を入れる（中国語を入れても読めない）。
--
-- 日本語名は1つの資料では埋まらないので、3つを順に見る。
--
--   1. CAJ.Substance   … 自社のデータベース。社内の呼び方にいちばん近い（29,300件）
--   2. CHRIP           … NITE の化学物質総合情報提供システム（11,023件）
--   3. LOLI CasSyns    … LangID=21 が日本語（16,528件）
--
-- 3つを合わせると、対象34,782件のうち30,668件に日本語名が付く。
-- 英語名は LOLI CasNames の代表名を使う。
--
-- 出力は cas / 日本語名 / 英語名 / 日本語名の出どころ の4列。
-- タブと改行は空白に潰す。TSVとして読むため。
SET NOCOUNT ON;

WITH target AS (
    SELECT DISTINCT Cas
    FROM ListData
    WHERE ListID IN (1945, 2579, 2171, 5380, 988, 7583, 8535, 9637, 3683)
),
loli_ja AS (
    SELECT Cas, Name,
           ROW_NUMBER() OVER (PARTITION BY Cas ORDER BY IsPrimary DESC, LEN(Name) ASC, SynID ASC) AS rn
    FROM CasSyns
    WHERE LangID = 21
),
caj AS (
    SELECT CAS, Name,
           ROW_NUMBER() OVER (PARTITION BY CAS ORDER BY IsMain DESC, LEN(Name) ASC) AS rn
    FROM CAJ.dbo.Substance
    WHERE Name IS NOT NULL AND LTRIM(RTRIM(Name)) <> ''
),
chrip AS (
    SELECT cas, chem_name,
           ROW_NUMBER() OVER (PARTITION BY cas ORDER BY LEN(chem_name) ASC) AS rn
    FROM CHRIP.dbo.chrip_substances
    WHERE chem_name IS NOT NULL AND LTRIM(RTRIM(chem_name)) <> ''
),
en AS (
    SELECT Cas, Name,
           ROW_NUMBER() OVER (PARTITION BY Cas ORDER BY LEN(Name) ASC) AS rn
    FROM CasNames
)
SELECT t.Cas,
       LEFT(REPLACE(REPLACE(REPLACE(COALESCE(caj.Name, chrip.chem_name, loli_ja.Name, ''), CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' '), 400) AS name_ja,
       LEFT(REPLACE(REPLACE(REPLACE(ISNULL(en.Name, ''), CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' '), 400) AS name_en,
       CASE
           WHEN caj.Name IS NOT NULL THEN 'CAJ'
           WHEN chrip.chem_name IS NOT NULL THEN 'CHRIP'
           WHEN loli_ja.Name IS NOT NULL THEN 'LOLI'
           ELSE ''
       END AS ja_source
FROM target t
LEFT JOIN caj ON caj.CAS = t.Cas AND caj.rn = 1
LEFT JOIN chrip ON chrip.cas = t.Cas AND chrip.rn = 1
LEFT JOIN loli_ja ON loli_ja.Cas = t.Cas AND loli_ja.rn = 1
LEFT JOIN en ON en.Cas = t.Cas AND en.rn = 1
ORDER BY t.Cas;
