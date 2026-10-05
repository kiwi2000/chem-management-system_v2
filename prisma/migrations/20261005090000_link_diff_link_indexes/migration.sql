-- 差分の控えのリンクへの参照に索引を足す（2026-10-05）。
-- リンクを消すとき、それを指す控えを探して消す（ON DELETE CASCADE）。索引が無いとリンク1件ごとに控え全体を読み、
-- 取り込み直しが何十分もかかった
CREATE INDEX "statutory_cas_link_diffs_current_link_id_idx" ON "statutory_cas_link_diffs"("current_link_id");

CREATE INDEX "statutory_cas_link_diffs_previous_link_id_idx" ON "statutory_cas_link_diffs"("previous_link_id");
