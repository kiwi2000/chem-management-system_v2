-- PRTR 届出データの入力（S22、2026-09-21）。
--
-- 所属（組織マスタの組織）× 年度で 1 組。方法（実測値・物質収支・排出係数）を選び、
-- 製品ごとの数量と、実測値のときは物質ごとの kg を入れる。
-- 権限の値は同じトランザクションの中で使えないので、管理者への付与は次の移行で行う。

ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'PRTR_ENTRY';

CREATE TYPE "PrtrMethod" AS ENUM ('MEASURED', 'BALANCE', 'FACTOR');
CREATE TYPE "PrtrEntrySource" AS ENUM ('MANUAL', 'IMPORT');

-- 届出データの頭
CREATE TABLE "prtr_entries" (
  "id"              TEXT NOT NULL,
  "organisation_id" TEXT NOT NULL,
  "fiscal_year"     INTEGER NOT NULL,
  "method"          "PrtrMethod" NOT NULL DEFAULT 'BALANCE',
  "factor_pct"      DECIMAL(9,4),
  "note"            TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"      TEXT,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  "updated_by"      TEXT,
  CONSTRAINT "prtr_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prtr_entries_organisation_id_fkey" FOREIGN KEY ("organisation_id")
    REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prtr_entries_organisation_id_fiscal_year_key"
  ON "prtr_entries" ("organisation_id", "fiscal_year");

-- 製品ごとの数量（kg）
CREATE TABLE "prtr_quantities" (
  "id"           TEXT NOT NULL,
  "entry_id"     TEXT NOT NULL,
  "product_id"   TEXT NOT NULL,
  "purchased_kg" DECIMAL(18,3) NOT NULL,
  "shipped_kg"   DECIMAL(18,3),
  "source"       "PrtrEntrySource" NOT NULL DEFAULT 'MANUAL',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  "updated_by"   TEXT,
  CONSTRAINT "prtr_quantities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prtr_quantities_entry_id_fkey" FOREIGN KEY ("entry_id")
    REFERENCES "prtr_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prtr_quantities_product_id_fkey" FOREIGN KEY ("product_id")
    REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prtr_quantities_entry_id_product_id_key" ON "prtr_quantities" ("entry_id", "product_id");
CREATE INDEX "prtr_quantities_product_id_idx" ON "prtr_quantities" ("product_id");

-- 実測値（kg、年間）。第一種指定化学物質ごと
CREATE TABLE "prtr_measured" (
  "id"                     TEXT NOT NULL,
  "entry_id"               TEXT NOT NULL,
  "statutory_substance_id" TEXT NOT NULL,
  "measured_kg"            DECIMAL(18,3) NOT NULL,
  "source"                 "PrtrEntrySource" NOT NULL DEFAULT 'MANUAL',
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  "updated_by"             TEXT,
  CONSTRAINT "prtr_measured_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prtr_measured_entry_id_fkey" FOREIGN KEY ("entry_id")
    REFERENCES "prtr_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prtr_measured_statutory_substance_id_fkey" FOREIGN KEY ("statutory_substance_id")
    REFERENCES "statutory_substances" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prtr_measured_entry_id_statutory_substance_id_key"
  ON "prtr_measured" ("entry_id", "statutory_substance_id");
CREATE INDEX "prtr_measured_statutory_substance_id_idx" ON "prtr_measured" ("statutory_substance_id");
