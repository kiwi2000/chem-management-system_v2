-- 書いた人への返事。
-- 受け取った側が1件だけ返す形にする（やり取りを重ねる想定は今は無い）。
-- 誰がいつ返したかも残す。返事が付いたかどうかを一覧で見分けられるようにするため。
ALTER TABLE "feedbacks"
  ADD COLUMN "reply" TEXT,
  ADD COLUMN "replied_by" TEXT,
  ADD COLUMN "replied_at" TIMESTAMP(3);
