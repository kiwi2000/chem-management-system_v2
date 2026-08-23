-- 法令の持ち主は地域ではなく国。国の表を後から足したので、付け替える。
-- laws はまだ空なので、列を作り直して差し支えない。
DROP INDEX "laws_region_id_idx";
ALTER TABLE "laws" DROP CONSTRAINT "laws_region_id_fkey";
ALTER TABLE "laws" DROP COLUMN "region_id";
ALTER TABLE "laws" ADD COLUMN "country_id" TEXT NOT NULL;

CREATE INDEX "laws_country_id_idx" ON "laws"("country_id");
ALTER TABLE "laws" ADD CONSTRAINT "laws_country_id_fkey"
    FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
