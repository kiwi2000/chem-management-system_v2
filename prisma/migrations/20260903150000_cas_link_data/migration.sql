-- リンク1本に付く、出どころの文章。
--
-- LOLI なら ListData.Data（「>= 0.3 wt% cut-off value (Attached table, 2-1437, [Toluene])」の類）。
-- どのデータソースでも入れられるが、無いリンクのほうが多いので別テーブルに置き、
-- 無ければ行を作らない。原文は出どころの言語のまま。日本語訳は出どころが持っていれば入れる。
CREATE TABLE "statutory_cas_link_data" (
  "link_id"    TEXT NOT NULL,
  "text"       TEXT NOT NULL,
  "text_ja"    TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "statutory_cas_link_data_pkey" PRIMARY KEY ("link_id")
);

ALTER TABLE "statutory_cas_link_data"
  ADD CONSTRAINT "statutory_cas_link_data_link_id_fkey"
  FOREIGN KEY ("link_id") REFERENCES "statutory_cas_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
