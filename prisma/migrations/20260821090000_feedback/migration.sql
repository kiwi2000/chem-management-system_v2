-- 使ってみて気づいたことの記録。開発中の窓口として使う。
-- 誰が書いたかは残すが、閲覧も更新もログインしている人なら誰でもできるため、権限は増やさない。

CREATE TYPE "FeedbackKind" AS ENUM ('BUG', 'REQUEST', 'QUESTION', 'OTHER');
CREATE TYPE "FeedbackPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ON_HOLD', 'DONE');

CREATE TABLE "feedbacks" (
  "id"         TEXT NOT NULL,
  "title"      VARCHAR(200) NOT NULL,
  "body"       TEXT NOT NULL,
  "kind"       "FeedbackKind" NOT NULL,
  "priority"   "FeedbackPriority" NOT NULL DEFAULT 'MEDIUM',
  "status"     "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feedbacks_status_idx"     ON "feedbacks"("status");
CREATE INDEX "feedbacks_kind_idx"       ON "feedbacks"("kind");
CREATE INDEX "feedbacks_updated_at_idx" ON "feedbacks"("updated_at");
