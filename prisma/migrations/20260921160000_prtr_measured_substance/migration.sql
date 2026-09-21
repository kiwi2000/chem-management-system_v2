-- 実測値に「打った物質」を持つ（S22、2026-09-21）。
-- 法文物質名からリンクの CAS をたどって代表物質を推測すると、打った物質と別のものが出ることがある
-- （ホルムアルデヒドの法文物質名にパラホルムアルデヒドも結び付いている）。物質を消せば空にする
ALTER TABLE "prtr_measured" ADD COLUMN "substance_id" TEXT;
ALTER TABLE "prtr_measured"
  ADD CONSTRAINT "prtr_measured_substance_id_fkey" FOREIGN KEY ("substance_id")
  REFERENCES "substances" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "prtr_measured_substance_id_idx" ON "prtr_measured" ("substance_id");
