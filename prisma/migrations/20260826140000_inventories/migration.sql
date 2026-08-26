-- 各国のインベントリ（既存化学物質名簿）。
--
-- **規制区分としては持たない。**
-- 判定は登録されている区分をすべて見に行くので、インベントリを区分として入れると
-- どの製品もすべてのインベントリに「該当」してしまい、判定表が使い物にならなくなる。
-- インベントリは「載っているかどうか」と「その名簿での番号」を持つだけのもので、
-- 含有率と閾値で当たりを決める規制とは性質が違う。
--
-- LOLI の行を**そのまま**持つ。番号の取り出しは、取り出しかたの設定（正規表現）を
-- 当てて画面で行う。こうしておくと、取り出しかたを直したときに取り込み直さずに済む
-- （本番からは LOLI に届かないので、取り込み直しは手元でしかできない）。

CREATE TABLE "inventories" (
  "id"              TEXT PRIMARY KEY,
  "code"            VARCHAR(50) NOT NULL,
  "code_normalized" VARCHAR(64) NOT NULL,
  "country_id"      TEXT NOT NULL REFERENCES "countries"("id"),
  "name_original"   TEXT NOT NULL,
  "name_lang"       VARCHAR(10) NOT NULL,
  "name_ja"         TEXT,
  "name_en"         TEXT,
  -- 取り込み元の LOLI の一覧番号。取り込み直すときに使う
  "source_list_id"  INTEGER,
  "display_order"   INTEGER NOT NULL DEFAULT 0,

  -- ここから下は「物質の画面に出すか、どう出すか」の設定
  -- 見出し。入っていなければ出さない
  "number_label"    TEXT,
  -- 出す順。法令の並びとは別に決める
  "number_order"    INTEGER NOT NULL DEFAULT 0,
  -- 行から番号を取り出す正規表現。全件一致で、1行から複数の番号が取れる
  "match_pattern"   TEXT,
  -- 表示の書き方。$1 などが使える。番号を持たない名簿は「該当」のような固定文字
  "display_format"  TEXT,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "updated_by" TEXT,
  "deleted_at" TIMESTAMP(3)
);

CREATE UNIQUE INDEX "inventories_code_normalized_key" ON "inventories"("code_normalized");
CREATE INDEX "inventories_country_id_display_order_idx" ON "inventories"("country_id", "display_order");

-- 名簿の1行。LOLI の Data をそのまま持つ
CREATE TABLE "inventory_rows" (
  "id"             TEXT PRIMARY KEY,
  "inventory_id"   TEXT NOT NULL REFERENCES "inventories"("id") ON DELETE CASCADE,
  "cas_number"     VARCHAR(20) NOT NULL,
  "cas_normalized" VARCHAR(20) NOT NULL,
  -- LOLI の Data。ここに正規表現を当てて番号を取り出す
  "data"           TEXT NOT NULL
);

-- 物質の画面は CAS から引く。ここが効かないと1件開くたびに全表を舐める
CREATE INDEX "inventory_rows_cas_normalized_idx" ON "inventory_rows"("cas_normalized");
-- 取り込み直すときに、その名簿のぶんだけ入れ替える
CREATE INDEX "inventory_rows_inventory_id_idx" ON "inventory_rows"("inventory_id");
