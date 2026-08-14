-- 主名称を substances 側の列に移し、substance_names は別名だけの表（substance_aliases）にする。
-- 一覧の並べ替え・絞り込みを名称で行いたいが、1対多の子テーブルの項目では並べ替えられないため。
-- docs/decisions/0006 参照。

-- 1) 主名称の列を追加し、既存の MAIN 行から値を移す
ALTER TABLE "substances" ADD COLUMN "name_ja" VARCHAR(500);
ALTER TABLE "substances" ADD COLUMN "name_en" VARCHAR(500);

UPDATE "substances" s
SET "name_ja" = n."name_ja", "name_en" = n."name_en"
FROM "substance_names" n
WHERE n."substance_id" = s."id" AND n."name_type" = 'MAIN';

-- 主名称が無い行は無いはずだが、NOT NULL を付けられるよう保険をかける
UPDATE "substances" SET "name_ja" = "code" WHERE "name_ja" IS NULL;

ALTER TABLE "substances" ALTER COLUMN "name_ja" SET NOT NULL;

CREATE INDEX "substances_name_ja_idx" ON "substances"("name_ja");
CREATE INDEX "substances_name_en_idx" ON "substances"("name_en");

-- 2) 別名だけの表に作り替える
DELETE FROM "substance_names" WHERE "name_type" = 'MAIN';

CREATE TABLE "substance_aliases" (
    "id" TEXT NOT NULL,
    "substance_id" TEXT NOT NULL,
    "name_ja" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "substance_aliases_pkey" PRIMARY KEY ("id")
);

INSERT INTO "substance_aliases" ("id", "substance_id", "name_ja", "name_en", "display_order")
SELECT "id", "substance_id", "name_ja", "name_en", COALESCE("display_order", 0)
FROM "substance_names";

CREATE INDEX "substance_aliases_substance_id_idx" ON "substance_aliases"("substance_id");
CREATE INDEX "substance_aliases_name_ja_idx" ON "substance_aliases"("name_ja");
CREATE INDEX "substance_aliases_name_en_idx" ON "substance_aliases"("name_en");

ALTER TABLE "substance_aliases" ADD CONSTRAINT "substance_aliases_substance_id_fkey"
  FOREIGN KEY ("substance_id") REFERENCES "substances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "substance_names";
DROP TYPE "SubstanceNameType";
