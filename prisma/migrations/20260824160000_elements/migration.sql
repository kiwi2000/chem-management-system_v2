-- 元素。法文物質名の「換算先」で選ぶ。
-- キーは元素記号。換算係数の表（metal_conversion_factors.metal_element）が記号で持っており、
-- そのまま突き合わせられるため。番号は並べ替えのために持つ。
--
-- シアンのように元素でないものも入れる（化管法が「シアンとして」換算せよと定めている）。
-- 元素番号を持たないので900番台を振る。実在する原子番号は最大118なので、
-- 便宜上の番号だと一目で分かる。
CREATE TABLE "elements" (
    "symbol"       VARCHAR(4) NOT NULL,
    "atomic_number" INTEGER NOT NULL,
    "name_ja"      VARCHAR(100) NOT NULL,
    "name_en"      VARCHAR(100) NOT NULL,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "elements_pkey" PRIMARY KEY ("symbol")
);

CREATE UNIQUE INDEX "elements_atomic_number_key" ON "elements" ("atomic_number");

-- 記号は1〜3文字の英字。先頭は大文字（Zn, Cl, CN など）
ALTER TABLE "elements" ADD CONSTRAINT "elements_symbol_format"
  CHECK ("symbol" ~ '^[A-Z][A-Za-z]{0,2}$');
