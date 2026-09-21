-- PRTR（S22-1、2026-09-21）。工場 → グループ → 会社の 3 段と、届出に要るマスタ。
--
-- データを入れるのは工場、届け出るのはグループ（お客様の運用では都道府県）。
-- 利用者は工場かグループのどちらか 1 つを担当する。
-- 権限の値は同じトランザクションの中で使えないので、管理者への付与は次の移行で行う。

ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'PRTR_SITE';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'PRTR_GROUP';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'PRTR_ADMIN';

-- グループ（届出上の事業所）
CREATE TABLE "prtr_groups" (
  "id"              TEXT NOT NULL,
  "code"            VARCHAR(50) NOT NULL,
  "code_normalized" VARCHAR(64) NOT NULL,
  "name_ja"         VARCHAR(200) NOT NULL,
  "name_kana"       VARCHAR(200),
  "name_en"         VARCHAR(200),
  "zip"             VARCHAR(10),
  "prefecture"      VARCHAR(50),
  "city"            VARCHAR(100),
  "town"            VARCHAR(200),
  "prefecture_kana" VARCHAR(100),
  "city_kana"       VARCHAR(200),
  "town_kana"       VARCHAR(400),
  "employee_num"    INTEGER,
  "display_order"   INTEGER NOT NULL DEFAULT 0,
  "note"            TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"      TEXT,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  "updated_by"      TEXT,
  "deleted_at"      TIMESTAMP(3),
  CONSTRAINT "prtr_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prtr_groups_code_normalized_key" ON "prtr_groups" ("code_normalized");
CREATE INDEX "prtr_groups_display_order_idx" ON "prtr_groups" ("display_order");

-- 工場（データを入れる単位）
CREATE TABLE "prtr_sites" (
  "id"              TEXT NOT NULL,
  "code"            VARCHAR(50) NOT NULL,
  "code_normalized" VARCHAR(64) NOT NULL,
  "group_id"        TEXT NOT NULL,
  "name_ja"         VARCHAR(200) NOT NULL,
  "name_en"         VARCHAR(200),
  "display_order"   INTEGER NOT NULL DEFAULT 0,
  "note"            TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"      TEXT,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  "updated_by"      TEXT,
  "deleted_at"      TIMESTAMP(3),
  CONSTRAINT "prtr_sites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prtr_sites_group_id_fkey" FOREIGN KEY ("group_id")
    REFERENCES "prtr_groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "prtr_sites_code_normalized_key" ON "prtr_sites" ("code_normalized");
CREATE INDEX "prtr_sites_group_id_idx" ON "prtr_sites" ("group_id");
CREATE INDEX "prtr_sites_display_order_idx" ON "prtr_sites" ("display_order");

-- 担当。工場かグループのどちらか一方（CHECK）。1 人 1 行は API が守る
CREATE TABLE "prtr_user_scopes" (
  "id"       TEXT NOT NULL,
  "user_id"  TEXT NOT NULL,
  "site_id"  TEXT,
  "group_id" TEXT,
  CONSTRAINT "prtr_user_scopes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prtr_user_scopes_one_of_check" CHECK (("site_id" IS NULL) <> ("group_id" IS NULL)),
  CONSTRAINT "prtr_user_scopes_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "prtr_user_scopes_site_id_fkey" FOREIGN KEY ("site_id")
    REFERENCES "prtr_sites" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "prtr_user_scopes_group_id_fkey" FOREIGN KEY ("group_id")
    REFERENCES "prtr_groups" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "prtr_user_scopes_user_id_idx" ON "prtr_user_scopes" ("user_id");
CREATE INDEX "prtr_user_scopes_site_id_idx" ON "prtr_user_scopes" ("site_id");
CREATE INDEX "prtr_user_scopes_group_id_idx" ON "prtr_user_scopes" ("group_id");

-- 主務大臣（届出先）
CREATE TABLE "prtr_ministers" (
  "id"            TEXT NOT NULL,
  "name"          VARCHAR(100) NOT NULL,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  "deleted_at"    TIMESTAMP(3),
  CONSTRAINT "prtr_ministers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "prtr_ministers_display_order_idx" ON "prtr_ministers" ("display_order");

-- 業種
CREATE TABLE "prtr_industries" (
  "id"                  TEXT NOT NULL,
  "code"                VARCHAR(10) NOT NULL,
  "name"                VARCHAR(200) NOT NULL,
  "default_minister_id" TEXT,
  "display_order"       INTEGER NOT NULL DEFAULT 0,
  "active"              BOOLEAN NOT NULL DEFAULT true,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  "deleted_at"          TIMESTAMP(3),
  CONSTRAINT "prtr_industries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prtr_industries_default_minister_id_fkey" FOREIGN KEY ("default_minister_id")
    REFERENCES "prtr_ministers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "prtr_industries_code_idx" ON "prtr_industries" ("code");
CREATE INDEX "prtr_industries_display_order_idx" ON "prtr_industries" ("display_order");

-- 事業者（届出者）。組織マスタの会社 1 件に添える
CREATE TABLE "prtr_registrants" (
  "organisation_id"        TEXT NOT NULL,
  "name_kana"              VARCHAR(200),
  "represent_name"         VARCHAR(200),
  "represent_name_kana"    VARCHAR(200),
  "agent_name"             VARCHAR(200),
  "agent_name_kana"        VARCHAR(200),
  "corporate_number"       VARCHAR(13),
  "last_year_company_name" VARCHAR(200),
  "zip"                    VARCHAR(10),
  "prefecture"             VARCHAR(50),
  "city"                   VARCHAR(100),
  "town"                   VARCHAR(200),
  "prefecture_kana"        VARCHAR(100),
  "city_kana"              VARCHAR(200),
  "town_kana"              VARCHAR(400),
  "updated_at"             TIMESTAMP(3) NOT NULL,
  "updated_by"             TEXT,
  CONSTRAINT "prtr_registrants_pkey" PRIMARY KEY ("organisation_id"),
  CONSTRAINT "prtr_registrants_organisation_id_fkey" FOREIGN KEY ("organisation_id")
    REFERENCES "organisations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 既定の主務大臣。「PRTR 届出の手引き」の業種コード・届出先一覧に出てくる大臣（id は固定）
INSERT INTO "prtr_ministers" ("id", "name", "display_order", "updated_at") VALUES
  ('prtr-min-meti',  '経済産業大臣', 1, CURRENT_TIMESTAMP),
  ('prtr-min-mhlw',  '厚生労働大臣', 2, CURRENT_TIMESTAMP),
  ('prtr-min-maff',  '農林水産大臣', 3, CURRENT_TIMESTAMP),
  ('prtr-min-mlit',  '国土交通大臣', 4, CURRENT_TIMESTAMP),
  ('prtr-min-mof',   '財務大臣',     5, CURRENT_TIMESTAMP),
  ('prtr-min-env',   '環境大臣',     6, CURRENT_TIMESTAMP),
  ('prtr-min-mext',  '文部科学大臣', 7, CURRENT_TIMESTAMP),
  ('prtr-min-mod',   '防衛大臣',     8, CURRENT_TIMESTAMP);

-- 既定の業種。同じ一覧の順（政令別表第二の号順）。複数の大臣が並ぶ業種は先頭の大臣を既定にし、
-- 「上記のいずれか」の自然科学研究所は既定なし
INSERT INTO "prtr_industries" ("id", "code", "name", "default_minister_id", "display_order", "updated_at") VALUES
  ('prtr-ind-0500', '0500', '金属鉱業',                                   'prtr-min-meti',  1, CURRENT_TIMESTAMP),
  ('prtr-ind-0700', '0700', '原油・天然ガス鉱業',                         'prtr-min-meti',  2, CURRENT_TIMESTAMP),
  ('prtr-ind-1200', '1200', '食料品製造業',                               'prtr-min-maff',  3, CURRENT_TIMESTAMP),
  ('prtr-ind-1300', '1300', '飲料・たばこ・飼料製造業（以下を除く。）',   'prtr-min-maff',  4, CURRENT_TIMESTAMP),
  ('prtr-ind-1320', '1320', '酒類製造業',                                 'prtr-min-mof',   5, CURRENT_TIMESTAMP),
  ('prtr-ind-1350', '1350', 'たばこ製造業',                               'prtr-min-mof',   6, CURRENT_TIMESTAMP),
  ('prtr-ind-1400', '1400', '繊維工業',                                   'prtr-min-meti',  7, CURRENT_TIMESTAMP),
  ('prtr-ind-1500', '1500', '衣服・その他の繊維製品製造業',               'prtr-min-meti',  8, CURRENT_TIMESTAMP),
  ('prtr-ind-1600', '1600', '木材・木製品製造業（家具を除く。）',         'prtr-min-maff',  9, CURRENT_TIMESTAMP),
  ('prtr-ind-1700', '1700', '家具・装備品製造業',                         'prtr-min-meti', 10, CURRENT_TIMESTAMP),
  ('prtr-ind-1800', '1800', 'パルプ・紙・紙加工品製造業',                 'prtr-min-meti', 11, CURRENT_TIMESTAMP),
  ('prtr-ind-1900', '1900', '出版・印刷・同関連産業',                     'prtr-min-meti', 12, CURRENT_TIMESTAMP),
  ('prtr-ind-2000', '2000', '化学工業（以下を除く。）',                   'prtr-min-meti', 13, CURRENT_TIMESTAMP),
  ('prtr-ind-2025', '2025', '塩製造業',                                   'prtr-min-mof',  14, CURRENT_TIMESTAMP),
  ('prtr-ind-2060', '2060', '医薬品製造業',                               'prtr-min-mhlw', 15, CURRENT_TIMESTAMP),
  ('prtr-ind-2092', '2092', '農薬製造業',                                 'prtr-min-maff', 16, CURRENT_TIMESTAMP),
  ('prtr-ind-2100', '2100', '石油製品・石炭製品製造業',                   'prtr-min-meti', 17, CURRENT_TIMESTAMP),
  ('prtr-ind-2200', '2200', 'プラスチック製品製造業',                     'prtr-min-meti', 18, CURRENT_TIMESTAMP),
  ('prtr-ind-2300', '2300', 'ゴム製品製造業',                             'prtr-min-meti', 19, CURRENT_TIMESTAMP),
  ('prtr-ind-2400', '2400', 'なめし革・同製品・毛皮製造業',               'prtr-min-meti', 20, CURRENT_TIMESTAMP),
  ('prtr-ind-2500', '2500', '窯業・土石製品製造業',                       'prtr-min-meti', 21, CURRENT_TIMESTAMP),
  ('prtr-ind-2600', '2600', '鉄鋼業',                                     'prtr-min-meti', 22, CURRENT_TIMESTAMP),
  ('prtr-ind-2700', '2700', '非鉄金属製造業',                             'prtr-min-meti', 23, CURRENT_TIMESTAMP),
  ('prtr-ind-2800', '2800', '金属製品製造業',                             'prtr-min-meti', 24, CURRENT_TIMESTAMP),
  ('prtr-ind-2900', '2900', '一般機械器具製造業',                         'prtr-min-meti', 25, CURRENT_TIMESTAMP),
  ('prtr-ind-3000', '3000', '電気機械器具製造業（以下を除く。）',         'prtr-min-meti', 26, CURRENT_TIMESTAMP),
  ('prtr-ind-3060', '3060', '電子応用装置製造業',                         'prtr-min-meti', 27, CURRENT_TIMESTAMP),
  ('prtr-ind-3070', '3070', '電気計測器製造業',                           'prtr-min-meti', 28, CURRENT_TIMESTAMP),
  ('prtr-ind-3100', '3100', '輸送用機械器具製造業（以下を除く。）',       'prtr-min-meti', 29, CURRENT_TIMESTAMP),
  ('prtr-ind-3120', '3120', '鉄道車両・同部分品製造業',                   'prtr-min-mlit', 30, CURRENT_TIMESTAMP),
  ('prtr-ind-3140', '3140', '船舶製造・修理業、舶用機関製造業',           'prtr-min-mlit', 31, CURRENT_TIMESTAMP),
  ('prtr-ind-3200', '3200', '精密機械器具製造業（以下を除く。）',         'prtr-min-meti', 32, CURRENT_TIMESTAMP),
  ('prtr-ind-3230', '3230', '医療用機械器具・医療用品製造業',             'prtr-min-meti', 33, CURRENT_TIMESTAMP),
  ('prtr-ind-3300', '3300', '武器製造業',                                 'prtr-min-meti', 34, CURRENT_TIMESTAMP),
  ('prtr-ind-3400', '3400', 'その他の製造業',                             'prtr-min-meti', 35, CURRENT_TIMESTAMP),
  ('prtr-ind-3500', '3500', '電気業',                                     'prtr-min-meti', 36, CURRENT_TIMESTAMP),
  ('prtr-ind-3600', '3600', 'ガス業',                                     'prtr-min-meti', 37, CURRENT_TIMESTAMP),
  ('prtr-ind-3700', '3700', '熱供給業',                                   'prtr-min-meti', 38, CURRENT_TIMESTAMP),
  ('prtr-ind-3830', '3830', '下水道業',                                   'prtr-min-mlit', 39, CURRENT_TIMESTAMP),
  ('prtr-ind-3900', '3900', '鉄道業',                                     'prtr-min-mlit', 40, CURRENT_TIMESTAMP),
  ('prtr-ind-4400', '4400', '倉庫業（倉庫業法に基づく登録を受けている事業者のうち農作物を保管するもの又は貯蔵タンクにより気体若しくは液体を貯蔵するものに限る。）', 'prtr-min-mlit', 41, CURRENT_TIMESTAMP),
  ('prtr-ind-5132', '5132', '石油卸売業',                                 'prtr-min-meti', 42, CURRENT_TIMESTAMP),
  ('prtr-ind-5142', '5142', '鉄スクラップ卸売業（自動車用エアコンディショナーに封入された物質を回収し又は自動車の車体に装着された自動車用エアコンディショナーを取り外すものに限る。）', 'prtr-min-meti', 43, CURRENT_TIMESTAMP),
  ('prtr-ind-5220', '5220', '自動車卸売業（自動車用エアコンディショナーに封入された物質を回収するものに限る。）', 'prtr-min-meti', 44, CURRENT_TIMESTAMP),
  ('prtr-ind-5930', '5930', '燃料小売業',                                 'prtr-min-meti', 45, CURRENT_TIMESTAMP),
  ('prtr-ind-7210', '7210', '洗濯業',                                     'prtr-min-mhlw', 46, CURRENT_TIMESTAMP),
  ('prtr-ind-7430', '7430', '写真業',                                     'prtr-min-meti', 47, CURRENT_TIMESTAMP),
  ('prtr-ind-7700', '7700', '自動車整備業',                               'prtr-min-mlit', 48, CURRENT_TIMESTAMP),
  ('prtr-ind-7810', '7810', '機械修理業',                                 'prtr-min-meti', 49, CURRENT_TIMESTAMP),
  ('prtr-ind-8620', '8620', '商品検査業',                                 'prtr-min-meti', 50, CURRENT_TIMESTAMP),
  ('prtr-ind-8630', '8630', '計量証明業（一般計量証明業を除く。）',       'prtr-min-meti', 51, CURRENT_TIMESTAMP),
  ('prtr-ind-8716', '8716', '一般廃棄物処理業（ごみ処分業に限る。）',     'prtr-min-env',  52, CURRENT_TIMESTAMP),
  ('prtr-ind-8722', '8722', '産業廃棄物処分業',                           'prtr-min-env',  53, CURRENT_TIMESTAMP),
  ('prtr-ind-8724', '8724', '特別管理産業廃棄物処分業',                   'prtr-min-env',  54, CURRENT_TIMESTAMP),
  ('prtr-ind-8800', '8800', '医療業',                                     'prtr-min-mhlw', 55, CURRENT_TIMESTAMP),
  ('prtr-ind-9140', '9140', '高等教育機関（付属施設を含み、人文科学のみに係るものを除く。）', 'prtr-min-mext', 56, CURRENT_TIMESTAMP),
  ('prtr-ind-9210', '9210', '自然科学研究所',                             NULL,            57, CURRENT_TIMESTAMP);
