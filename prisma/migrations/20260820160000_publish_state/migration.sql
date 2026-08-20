-- 承認の流れを入れる。
-- 真偽値の draft_flag では「作成中／承認待ち／却下／公開済」を表せないため、状態の列に置き換える。
-- 廃番かどうか（status）は今までどおり別の軸のまま。

CREATE TYPE "PublishState" AS ENUM ('DRAFT', 'PENDING', 'REJECTED', 'PUBLISHED');
CREATE TYPE "ApprovalAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'WITHDRAW', 'UNPUBLISH');

-- 既存データは「ドラフト＝作成中」「完成＝公開済」として引き継ぐ
ALTER TABLE "substances" ADD COLUMN "publish_state" "PublishState" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "products"   ADD COLUMN "publish_state" "PublishState" NOT NULL DEFAULT 'DRAFT';
UPDATE "substances" SET "publish_state" = CASE WHEN "draft_flag" THEN 'DRAFT'::"PublishState" ELSE 'PUBLISHED'::"PublishState" END;
UPDATE "products"   SET "publish_state" = CASE WHEN "draft_flag" THEN 'DRAFT'::"PublishState" ELSE 'PUBLISHED'::"PublishState" END;

DROP INDEX IF EXISTS "substances_draft_flag_idx";
DROP INDEX IF EXISTS "products_draft_flag_idx";
ALTER TABLE "substances" DROP COLUMN "draft_flag";
ALTER TABLE "products"   DROP COLUMN "draft_flag";

CREATE INDEX "substances_publish_state_idx" ON "substances"("publish_state");
CREATE INDEX "products_publish_state_idx"   ON "products"("publish_state");

-- 承認の履歴
CREATE TABLE "approval_events" (
    "id" TEXT NOT NULL,
    "entity" VARCHAR(20) NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "actor_id" TEXT,
    "comment" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approval_events_entity_entity_id_created_at_idx"
    ON "approval_events"("entity", "entity_id", "created_at");

-- 承認できる権限。既存の型に値を足すだけなので作り直しは不要
ALTER TYPE "Permission" ADD VALUE 'APPROVE';
