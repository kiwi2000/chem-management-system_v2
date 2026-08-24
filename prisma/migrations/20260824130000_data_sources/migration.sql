-- 呼び名を整理した。
--   sources              … データソース種別（LOLI・CHRIP・自社データ）
--   link_set_versions    … バージョン
--   link_version_sources … データソース（バージョン × 種別）
--
-- バージョンはコードだけを登録する形にしたので、名称は必須をやめる。
ALTER TABLE "link_set_versions" ALTER COLUMN "name_ja" DROP NOT NULL;

-- データソースには説明を書けるようにする（どのファイルを入れたか、範囲はどこまでか）。
-- 取込日も、バージョン単位ではなくデータソース単位で持つ。
-- ファイルは種別ごとに届き、入れ替えも種別ごとに行うため。
ALTER TABLE "link_version_sources"
  ADD COLUMN "note" TEXT,
  ADD COLUMN "loaded_at" TIMESTAMP(3);
