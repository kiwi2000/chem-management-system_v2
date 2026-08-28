-- 数字を数として読む並べ方。
--
-- CAS番号は文字として比べると「100-42-5」が「9-99-9」より前に来てしまう。
-- 画面では Intl.Collator("ja", { numeric: true }) で数として比べていたので、
-- 並べ替えをデータベース側に移すにあたり、同じ見かたをこちらにも用意する。
CREATE COLLATION IF NOT EXISTS chem_natural (provider = icu, locale = 'ja-u-kn-true');
