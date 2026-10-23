-- フィードバックの通番（2026-10-23 指示）。最初に書かれた順に 1 から振る。消したものも番号を持ったまま（欠番になる）
ALTER TABLE "feedbacks" ADD COLUMN "seq_no" INTEGER;

UPDATE "feedbacks" AS f
SET "seq_no" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS rn
  FROM "feedbacks"
) AS n
WHERE f."id" = n."id";

ALTER TABLE "feedbacks" ALTER COLUMN "seq_no" SET NOT NULL;

CREATE UNIQUE INDEX "feedbacks_seq_no_key" ON "feedbacks"("seq_no");
