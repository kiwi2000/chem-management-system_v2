-- **sqlcmd は `-u` を付けて流す。**付けないと出力が Shift-JIS になり、
-- 日本語名が化ける（2026-08-27 に実際に 7,902件を壊した）。
-- 取り出しは scripts/loli-dump-names.sh を使う。
--
-- **この SQL は CRLF で保存する。**LF だけにすると、日本語のコメントの
-- 最後のバイトが次の改行を飲み込み、コメントが次の行まで伸びて構文エラーになる。
--
-- CAS番号ごとの物質名。物質マスタに登録するために使う。
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

-- **取り込みに使う一覧を全部並べる。**ここを増やし忘れると、
-- 新しく結んだCASに名前が付かず、画面にCAS番号だけが並ぶ（第12章 12-6）。
-- EU CLP附属書VI だけ一覧ではなく CasKeys から引くので、別に足す
-- **取り込みに使う一覧を全部並べる。**ここを増やし忘れると、
-- 新しく結んだCASに名前が付かず、画面にCAS番号だけが並ぶ（第12章 12-6）。
--
--   631 634 4589 10077        化審法
--   9013 9014                 化管法
--   1015                      毒劇法
--   9908 9906 9907 9905       安衛法 表示・通知
--   1818 1816 2226 1813 4534  安衛法 製造許可・禁止・特化則・有機溶剤・特別管理
--   7782 5605 5606 4021       大防法・水濁法・土対法
--   4043 4048 4050 4055 4056 4057   化学兵器禁止法
--   428 635                   米国 EPCRA 313・TSCA 第6条
--   3614 2459 3611            EU REACH 附属書XIV・XVII・SVHC
--
-- **EU CLP附属書VI は一覧ではなく CasKeys（Annex）から引く**ので、UNION で足す。
WITH target AS (
    SELECT DISTINCT Cas
    FROM ListData
    WHERE ListID IN (
        631, 634, 4589, 10077,
        9013, 9014,
        1015,
        9908, 9906, 9907, 9905,
        1818, 1816, 2226, 1813, 4534,
        7782, 5605, 5606, 4021,
        4043, 4048, 4050, 4055, 4056, 4057,
        428, 635,
        3614, 2459, 3611
    )
    UNION
    SELECT DISTINCT Cas FROM CasKeys WHERE DataKeyType = 'Annex'
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
