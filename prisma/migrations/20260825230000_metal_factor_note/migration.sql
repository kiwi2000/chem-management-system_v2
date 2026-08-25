-- 換算係数に「どこから来た値か」を残す。人が入れた値を機械が上書きしないための目印。

ALTER TABLE "metal_conversion_factors" ADD COLUMN "note" TEXT;
