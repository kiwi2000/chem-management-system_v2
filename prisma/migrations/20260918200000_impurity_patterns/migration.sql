-- 不純物パターン（S21、2026-09-18）。
--
-- 不純物・副生成物として含まれる物質は、規制によっては裾切値以上でも非該当になる。
-- 物質に「不純物パターン」を持たせ、パターンごとに「どの規制区分・法文物質名で非該当にするか」を
-- 設定できるようにする。0「不純物ではない」と 1「不純物」は組み込み（消せない）。
-- 既存の物質は全部 0。

CREATE TABLE "impurity_patterns" (
  "id"              TEXT NOT NULL,
  "code"            VARCHAR(50) NOT NULL,
  "code_normalized" VARCHAR(64) NOT NULL,
  "name_ja"         TEXT NOT NULL,
  "name_en"         TEXT,
  "note"            TEXT,
  "display_order"   INTEGER NOT NULL DEFAULT 0,
  "builtin"         BOOLEAN NOT NULL DEFAULT false,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"      TEXT,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  "updated_by"      TEXT,
  "deleted_at"      TIMESTAMP(3),
  CONSTRAINT "impurity_patterns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "impurity_patterns_code_normalized_key" ON "impurity_patterns" ("code_normalized");

-- 組み込みの 2 つ。id は固定（データソースの src-user と同じやり方）
INSERT INTO "impurity_patterns"
  ("id", "code", "code_normalized", "name_ja", "name_en", "display_order", "builtin", "updated_at")
VALUES
  ('ip-none',     '0', '0', '不純物ではない', 'Not an impurity', 0, true, CURRENT_TIMESTAMP),
  ('ip-impurity', '1', '1', '不純物',         'Impurity',        1, true, CURRENT_TIMESTAMP);

-- 物質のパターン。既存は全部 0
ALTER TABLE "substances"
  ADD COLUMN "impurity_pattern_id" TEXT NOT NULL DEFAULT 'ip-none';
ALTER TABLE "substances"
  ADD CONSTRAINT "substances_impurity_pattern_id_fkey"
  FOREIGN KEY ("impurity_pattern_id") REFERENCES "impurity_patterns" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "substances_impurity_pattern_id_idx" ON "substances" ("impurity_pattern_id");

-- 代表物質は CAS × パターンごとに 1 件（いままでは CAS ごとに 1 件）
DROP INDEX "substances_cas_representative_key";
CREATE UNIQUE INDEX "substances_cas_representative_key"
  ON "substances" ("cas_normalized", "impurity_pattern_id")
  WHERE "is_cas_representative" AND "deleted_at" IS NULL;

-- 展開結果の行も CAS × パターン。同じ CAS がパターン違いで 2 行になる
ALTER TABLE "product_expansion_lines"
  ADD COLUMN "impurity_pattern_id" TEXT NOT NULL DEFAULT 'ip-none';
-- いまの一意索引の名前は、Prisma が 63 文字で切ったもの
DROP INDEX "product_expansion_lines_product_id_cas_normalized_substance__ke";
CREATE UNIQUE INDEX "product_expansion_lines_key_cas_pattern"
  ON "product_expansion_lines" ("product_id", "cas_normalized", "substance_id", "impurity_pattern_id");

-- 除外の設定：パターン × 規制区分
CREATE TABLE "impurity_exemptions" (
  "id"          TEXT NOT NULL,
  "pattern_id"  TEXT NOT NULL,
  "category_id" TEXT NOT NULL,
  "excluded"    BOOLEAN NOT NULL DEFAULT true,
  "note"        TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"  TEXT,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  "updated_by"  TEXT,
  CONSTRAINT "impurity_exemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "impurity_exemptions_pattern_id_fkey"
    FOREIGN KEY ("pattern_id") REFERENCES "impurity_patterns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "impurity_exemptions_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "regulation_categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "impurity_exemptions_pattern_id_category_id_key"
  ON "impurity_exemptions" ("pattern_id", "category_id");
CREATE INDEX "impurity_exemptions_category_id_idx" ON "impurity_exemptions" ("category_id");

-- 除外の設定：パターン × 法文物質名（区分の設定を上書き。true=除外する、false=除外しない）
CREATE TABLE "impurity_exemption_substances" (
  "id"                     TEXT NOT NULL,
  "pattern_id"             TEXT NOT NULL,
  "statutory_substance_id" TEXT NOT NULL,
  "excluded"               BOOLEAN NOT NULL,
  "note"                   TEXT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"             TEXT,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  "updated_by"             TEXT,
  CONSTRAINT "impurity_exemption_substances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "impurity_exemption_substances_pattern_id_fkey"
    FOREIGN KEY ("pattern_id") REFERENCES "impurity_patterns" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "impurity_exemption_substances_statutory_substance_id_fkey"
    FOREIGN KEY ("statutory_substance_id") REFERENCES "statutory_substances" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "impurity_exemption_substances_pattern_id_statutory_substance_id_key"
  ON "impurity_exemption_substances" ("pattern_id", "statutory_substance_id");
CREATE INDEX "impurity_exemption_substances_statutory_substance_id_idx"
  ON "impurity_exemption_substances" ("statutory_substance_id");
