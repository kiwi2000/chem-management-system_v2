-- 各国のインベントリ（既存化学物質名簿）を LOLI から取り出す。
--
-- 出力は list_id / cas / data の3列。**Data は加工しない。**
-- 番号の取り出しかたは、こちら側の設定（正規表現）で決めるので、
-- 元の文字列をそのまま持っておく。
--
-- 取り出すのは SDS の第15項で在否を書く国のもの。
-- どの ListID が何かは docs/LOLI取り込み記録_インベントリ.md にある。
--
-- タブと改行は空白に潰す（TSVとして読むため）。
-- 1400字を超える行はほとんど無いので、そこで切る。
SET NOCOUNT ON;

SELECT ListID,
       CAST(Cas AS varchar(20)) AS cas,
       LEFT(
         REPLACE(REPLACE(REPLACE(CAST(Data AS varchar(max)), CHAR(9), ' '), CHAR(13), ' '), CHAR(10), ' '),
         1400
       ) AS data
  FROM ListData
 WHERE ListID IN (
         622,   -- 日本 ENCS（化審法）
         3830,  -- 日本 ISHL（安衛法）
         115,   -- EU EINECS
         100,   -- 米国 TSCA
         101,   -- カナダ DSL
         102,   -- カナダ NDSL
         740,   -- 中国 IECSC
         633,   -- 韓国 KECI
         6575,  -- 台湾 TCSI
         620,   -- 豪州 AIIC
         621,   -- フィリピン PICCS
         3005   -- ニュージーランド NZIoC
       )
   -- CAS番号の形をしていないもの（LOLI のまとめ番号 RR-... など）は取らない
   AND CAST(Cas AS varchar(20)) LIKE '%[0-9]-[0-9][0-9]-[0-9]'
 ORDER BY ListID, Cas;
