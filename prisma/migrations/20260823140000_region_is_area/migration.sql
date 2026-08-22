-- 地域は「アジア」「欧州」のようなまとまりを指す。
-- 国（日本・アメリカ合衆国など）は地域ではないので、ここには入れない。
-- 当初「くくり」の列を別に持たせていたが、それがそのまま地域なので列を落とす。
DROP INDEX "regions_group_idx";
ALTER TABLE "regions" DROP COLUMN "group";
