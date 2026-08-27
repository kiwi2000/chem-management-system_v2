-- インベントリの行にデータソースを持たせる。
--
-- バージョンだけでは足りない。同じインベントリ（ENCS など）を別々のところから取れるためで、
-- どちらを採るかはバージョンごとの優先度（`link_version_sources`）で決まる。
-- CASリンク（`statutory_cas_links`）と同じ持ちかたにそろえる。
-- **列の中身が違うだけで、仕組みは他の法規制データと同じ**にしておく。

ALTER TABLE "inventory_rows" ADD COLUMN "source_id" TEXT;

-- 既存の行は LOLI から取り込んだもの。無ければ、いちばん古いデータソースに寄せる
UPDATE "inventory_rows" SET "source_id" = COALESCE(
  (SELECT "id" FROM "sources" WHERE "code_normalized" = 'LOLI' AND "deleted_at" IS NULL LIMIT 1),
  (SELECT "id" FROM "sources" WHERE "deleted_at" IS NULL ORDER BY "created_at" LIMIT 1)
);

-- データソースが1つも無いのに行がある状態は、そのままでは優先度を解けない。ここで気づく
ALTER TABLE "inventory_rows" ALTER COLUMN "source_id" SET NOT NULL;

ALTER TABLE "inventory_rows"
  ADD CONSTRAINT "inventory_rows_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id");

-- 重複はデータソースごとに見る。別のところから取った同じ番号は、別の行として残す
-- （どちらを採るかは優先度で決めるので、両方持っていないと比べられない）
DROP INDEX "inventory_rows_version_inventory_cas_value_key";
CREATE UNIQUE INDEX "inventory_rows_version_source_inventory_cas_value_key"
  ON "inventory_rows"("version_id", "source_id", "inventory_id", "cas_normalized", "value");
