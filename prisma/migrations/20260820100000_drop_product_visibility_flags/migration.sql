-- 製品の「非公開」「組成公開」フラグを廃止する。
-- 誰に何を見せるかは、ユーザーに付与した権限だけで決める方針に変更したため。
ALTER TABLE "products" DROP COLUMN "private_flag";
ALTER TABLE "products" DROP COLUMN "composition_public_flag";
