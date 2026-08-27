-- インベントリをバージョンの管理下に置き、番号の設定をインベントリ側に一本化する。
--
-- ここまでの形には、噛み合わない点が3つあった。
--
--   1. インベントリの行が**バージョンを持たない**。インベントリは改訂されるので、
--      「いつ時点のインベントリで見たか」が残らないと判定の跡をたどれない
--   2. 番号を出す設定が**2か所に分かれていた**。規制区分側（システム設定の画面で触れる）と
--      インベントリ側（取り込みスクリプトが直接書く）。画面に出ているのはほぼインベントリ側なのに、
--      触れるのは規制区分側だけ、という食い違いが起きていた
--   3. 出すのをやめるには**呼び名を消すしかなかった**。また出したくなったとき、
--      付け直すことになる
--
-- 1 は行にバージョンを持たせて直す。2 は規制区分側の仕組みを畳んでインベントリ側に寄せる。
-- 3 は呼び名とは別に「出すか」の印を持たせて直す。

-- --- 1. インベントリの行にバージョンを持たせる -------------------------------------------------

ALTER TABLE "inventory_rows" ADD COLUMN "version_id" TEXT;

-- 既存の行は現在のバージョンのものとして扱う。取り込んだ時点のバージョンが現在のバージョンだったため。
-- 現在のバージョンが立っていなければ、いちばん新しいバージョンに寄せる
UPDATE "inventory_rows" SET "version_id" = (
  SELECT "id" FROM "link_set_versions"
  WHERE "deleted_at" IS NULL
  ORDER BY "is_current" DESC, "created_at" DESC
  LIMIT 1
);

-- バージョンが1つも無いのに行がある状態は、そのままではバージョンで引けない。ここで気づけるようにする
ALTER TABLE "inventory_rows" ALTER COLUMN "version_id" SET NOT NULL;

ALTER TABLE "inventory_rows"
  ADD CONSTRAINT "inventory_rows_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "link_set_versions"("id") ON DELETE CASCADE;

-- だれがいつ直したかを残す。画面から足せるようにするため
ALTER TABLE "inventory_rows" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "inventory_rows" ADD COLUMN "created_by" TEXT;
ALTER TABLE "inventory_rows" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "inventory_rows" ADD COLUMN "updated_by" TEXT;

-- 同じ値の重複はバージョンごとに見る。バージョンが違えば同じ番号があってよい
DROP INDEX "inventory_rows_inventory_cas_value_key";
CREATE UNIQUE INDEX "inventory_rows_version_inventory_cas_value_key"
  ON "inventory_rows"("version_id", "inventory_id", "cas_normalized", "value");

-- 物質の画面は「現在のバージョン × CAS」で引く。CAS だけの索引ではバージョンの絞りが効かない
DROP INDEX "inventory_rows_cas_normalized_idx";
CREATE INDEX "inventory_rows_version_id_cas_normalized_idx"
  ON "inventory_rows"("version_id", "cas_normalized");

-- --- 2. インベントリに「番号として出すか」の印を足す -----------------------------------

ALTER TABLE "inventories" ADD COLUMN "number_shown" BOOLEAN NOT NULL DEFAULT false;

-- これまでは「呼び名が入っていれば出す」だった。その状態を写し取る
UPDATE "inventories" SET "number_shown" = true WHERE "number_label" IS NOT NULL;

-- --- 3. 規制区分から番号の仕組みを外す -----------------------------------------

DROP INDEX "regulation_categories_number_label_idx";
ALTER TABLE "regulation_categories" DROP COLUMN "number_label";
ALTER TABLE "regulation_categories" DROP COLUMN "number_order";
