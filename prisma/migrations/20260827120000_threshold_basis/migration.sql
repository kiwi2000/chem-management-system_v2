-- 閾値が**何に対する濃度か**を、規制区分に持たせる。
--
-- ほとんどの法令は製品（成形品）全体に対する重量%で決まる。
-- ところが RoHS は**均質材料あたり**で決まる。ねじのめっき、基板のはんだ、
-- といった分けられない単位ごとに見るもので、製品全体で割ると必ず薄まる。
--
--   はんだに鉛が30% → 製品全体では0.05% → 製品基準なら非該当
--   しかし RoHS では違反
--
-- こちらの組成は製品全体でしか持っていないので、**判定は出せても言い切れない**。
-- 均質材料あたりの区分は、当たっても当たらなくても必ず要確認にする。
-- 見落としを黙って通すより、毎回止めて人に確かめさせるほうが安全なため。

CREATE TYPE "ThresholdBasis" AS ENUM ('PRODUCT', 'HOMOGENEOUS_MATERIAL');

ALTER TABLE "regulation_categories"
  ADD COLUMN "threshold_basis" "ThresholdBasis" NOT NULL DEFAULT 'PRODUCT';
