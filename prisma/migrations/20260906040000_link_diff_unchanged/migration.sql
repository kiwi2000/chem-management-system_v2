-- 差分の種類に「変更なし」を足す。
--
-- 差分の表には 追加・削除・変更 だけを置いていたが、「変わっていないもの」も同じ表で
-- 絞り込んで見たいという要望があった。同じ行も UNCHANGED として置き、
-- 何も絞っていないときは出さない（画面側で除く）。
ALTER TYPE "LinkDiffKind" ADD VALUE 'UNCHANGED';

-- 作ってある差分は「変更なし」の行を持っていないので、次に見たときに作り直させる
DELETE FROM "statutory_cas_link_diffs";
DELETE FROM "statutory_cas_link_diff_runs";
