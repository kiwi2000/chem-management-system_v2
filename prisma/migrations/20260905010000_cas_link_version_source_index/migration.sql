-- 外部データベースの画面で「バージョン × データソース」の対象CASを一覧にする。
--
-- 今までのインデックスは判定用（version_id, cas_normalized）と法文物質名用
-- （statutory_substance_id）だけで、バージョンとデータソースで全体を引く道が無かった。
-- 20万行規模を毎回全部なめないよう、この組で引けるようにする。
CREATE INDEX "statutory_cas_links_version_id_source_id_idx" ON "statutory_cas_links"("version_id", "source_id");
