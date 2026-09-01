-- 規制区分に「スコア」を、物質に「スコア」と「ランク」を足す。
--
-- **手で書いた。**ローカルの開発用DBに、移行履歴に無い索引の差分が残っており、
-- `prisma migrate dev` がデータベースの作り直しを求めてくるため
-- （59,266件の物質と56万件のCASリンクを消すわけにはいかない）。
-- 生成された差分には、その食い違いを埋めるための削除も混ざっていたので、
-- **この機能に要るぶんだけ**を取り出してある。

-- 人が決める評価点。既定は0
ALTER TABLE "regulation_categories" ADD COLUMN "score" DECIMAL(9,3) NOT NULL DEFAULT 0;

-- 当たっている区分のスコアの合計と、そこから決まる段階
ALTER TABLE "substances" ADD COLUMN     "score" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "score_at" TIMESTAMP(3),
ADD COLUMN     "score_rank" VARCHAR(50);

-- 物質のスコアを段階に読み替える表。何段でも足せる
CREATE TABLE "substance_rank_bands" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(50) NOT NULL,
    "lower_value" DECIMAL(12,3),
    "lower_bound" "ThresholdBound",
    "upper_value" DECIMAL(12,3),
    "upper_bound" "ThresholdBound",
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "substance_rank_bands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "substance_rank_bands_display_order_idx" ON "substance_rank_bands"("display_order");

-- 一覧で並べ替え・絞り込みに使う
CREATE INDEX "substances_score_idx" ON "substances"("score");

-- CreateIndex
CREATE INDEX "substances_score_rank_idx" ON "substances"("score_rank");
