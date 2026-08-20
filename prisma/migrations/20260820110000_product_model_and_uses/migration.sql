-- 製品に「型式」（単一選択）と「用途」（複数選択）を持たせる。
-- 選べる値はシステム設定側に持ち、ここには選んだ文字列をそのまま残す。
ALTER TABLE "products" ADD COLUMN "model_value" VARCHAR(100);

CREATE TABLE "product_uses" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "value" VARCHAR(100) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_uses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_uses_product_id_value_key" ON "product_uses"("product_id", "value");
CREATE INDEX "product_uses_value_idx" ON "product_uses"("value");

ALTER TABLE "product_uses" ADD CONSTRAINT "product_uses_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;