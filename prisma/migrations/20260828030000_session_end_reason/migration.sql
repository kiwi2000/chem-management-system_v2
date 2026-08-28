-- セッションを切るときに行を消さず、理由を書き残す。
-- 消していたため、ログイン画面で「なぜ切れたか」を言い分けられなかった。

ALTER TABLE "sessions" ADD COLUMN "ended_at" TIMESTAMP(3);
ALTER TABLE "sessions" ADD COLUMN "ended_reason" TEXT;
