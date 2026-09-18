-- 承認履歴の「実行した人」で並べ替え・絞り込みできるようにする（2026-09-18 指示）。
-- 名前は利用者の表にあるので、関連を張って DB 側で並べられるようにする。
--
-- 利用者は論理削除（deleted_at）なので行は残るが、
-- 昔のデータに居ない利用者を指しているものがあると外部キーを張れないので、先に空にする。
UPDATE "approval_events"
SET "actor_id" = NULL
WHERE "actor_id" IS NOT NULL
  AND "actor_id" NOT IN (SELECT "id" FROM "users");

CREATE INDEX "approval_events_actor_id_idx" ON "approval_events" ("actor_id");

-- 万一その人の行が消えても、履歴そのものは残す（実行した人だけが空になる）
ALTER TABLE "approval_events"
  ADD CONSTRAINT "approval_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
