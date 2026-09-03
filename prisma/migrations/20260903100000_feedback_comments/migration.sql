-- フィードバックの返信。
--
-- これまでは「受け取った側が1件だけ返事を書く」形で、書き直しで直していた。
-- **書いた内容は直さず、返信を重ねる**形に変える。元の書き込みにも、どの返信にも
-- （自分のものにも）返信できる。parent_id が NULL なら元の書き込みへの返信。
CREATE TABLE "feedback_comments" (
  "id"          TEXT NOT NULL,
  "feedback_id" TEXT NOT NULL,
  "parent_id"   TEXT,
  "body"        TEXT NOT NULL,
  "created_by"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"  TIMESTAMP(3),
  CONSTRAINT "feedback_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feedback_comments_feedback_id_idx" ON "feedback_comments"("feedback_id");

ALTER TABLE "feedback_comments"
  ADD CONSTRAINT "feedback_comments_feedback_id_fkey"
  FOREIGN KEY ("feedback_id") REFERENCES "feedbacks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "feedback_comments"
  ADD CONSTRAINT "feedback_comments_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "feedback_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- これまでの1件だけの返事を、最初の返信として移す（誰がいつ返したかも引き継ぐ）
INSERT INTO "feedback_comments" ("id", "feedback_id", "body", "created_by", "created_at")
SELECT 'fbc_' || "id", "id", "reply", "replied_by", COALESCE("replied_at", "updated_at")
FROM "feedbacks"
WHERE "reply" IS NOT NULL AND "reply" <> '';

ALTER TABLE "feedbacks"
  DROP COLUMN "reply",
  DROP COLUMN "replied_by",
  DROP COLUMN "replied_at";
