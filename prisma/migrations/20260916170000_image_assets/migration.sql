-- 画像ライブラリ（2026-09-16 指示）。テンプレートの「画像」ブロックが使う画像を DB に置く
CREATE TABLE "image_assets" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "mime" VARCHAR(64) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "image_assets_created_at_idx" ON "image_assets"("created_at");
