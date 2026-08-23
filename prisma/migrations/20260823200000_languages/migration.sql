-- 言語。法規制の名称で「原文の言語」として選ぶ。
-- 設定に文字列で並べていたものを表に移した（名前を持たせ、選択式にするため）。
CREATE TABLE "languages" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(2) NOT NULL,
    "name_ja" VARCHAR(100) NOT NULL,
    "name_en" VARCHAR(100) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");
CREATE INDEX "languages_display_order_idx" ON "languages"("display_order");

-- コードは大文字2文字だけ（ISO 639-1 を大文字にしたもの）
ALTER TABLE "languages" ADD CONSTRAINT "languages_code_format"
  CHECK ("code" ~ '^[A-Z]{2}$');

-- 法規制でよく使う言語を入れておく。並び順は、この一覧で扱う法規制の多い順
INSERT INTO "languages" ("id", "code", "name_ja", "name_en", "display_order", "updated_at") VALUES
  ('lang_ja', 'JA', '日本語',         'Japanese',   10, CURRENT_TIMESTAMP),
  ('lang_en', 'EN', '英語',           'English',    20, CURRENT_TIMESTAMP),
  ('lang_zh', 'ZH', '中国語',         'Chinese',    30, CURRENT_TIMESTAMP),
  ('lang_ko', 'KO', '韓国語',         'Korean',     40, CURRENT_TIMESTAMP),
  ('lang_th', 'TH', 'タイ語',         'Thai',       50, CURRENT_TIMESTAMP),
  ('lang_vi', 'VI', 'ベトナム語',     'Vietnamese', 60, CURRENT_TIMESTAMP),
  ('lang_id', 'ID', 'インドネシア語', 'Indonesian', 70, CURRENT_TIMESTAMP),
  ('lang_ms', 'MS', 'マレー語',       'Malay',      80, CURRENT_TIMESTAMP),
  ('lang_tl', 'TL', 'タガログ語',     'Tagalog',    90, CURRENT_TIMESTAMP),
  ('lang_hi', 'HI', 'ヒンディー語',   'Hindi',     100, CURRENT_TIMESTAMP),
  ('lang_de', 'DE', 'ドイツ語',       'German',    110, CURRENT_TIMESTAMP),
  ('lang_fr', 'FR', 'フランス語',     'French',    120, CURRENT_TIMESTAMP),
  ('lang_es', 'ES', 'スペイン語',     'Spanish',   130, CURRENT_TIMESTAMP),
  ('lang_it', 'IT', 'イタリア語',     'Italian',   140, CURRENT_TIMESTAMP),
  ('lang_nl', 'NL', 'オランダ語',     'Dutch',     150, CURRENT_TIMESTAMP),
  ('lang_pl', 'PL', 'ポーランド語',   'Polish',    160, CURRENT_TIMESTAMP),
  ('lang_pt', 'PT', 'ポルトガル語',   'Portuguese',170, CURRENT_TIMESTAMP),
  ('lang_ru', 'RU', 'ロシア語',       'Russian',   180, CURRENT_TIMESTAMP),
  ('lang_tr', 'TR', 'トルコ語',       'Turkish',   190, CURRENT_TIMESTAMP),
  ('lang_ar', 'AR', 'アラビア語',     'Arabic',    200, CURRENT_TIMESTAMP);

-- すでに入っている法規制の言語は小文字（ja）なので、大文字に揃える
UPDATE "laws"                  SET "name_lang" = upper("name_lang");
UPDATE "regulation_categories" SET "name_lang" = upper("name_lang");
UPDATE "regulation_classes"    SET "name_lang" = upper("name_lang") WHERE "name_lang" IS NOT NULL;
UPDATE "statutory_substances"  SET "name_lang" = upper("name_lang");

-- 設定に持っていた言語コードの一覧は、この表に置き換わったので消す
DELETE FROM "system_settings" WHERE "key" = 'law.language_codes';
