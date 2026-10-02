-- 接続元IPアドレスの WHOIS（JPNIC）の結果をためておく表（2026-10-02）
CREATE TABLE "ip_whois" (
    "id" TEXT NOT NULL,
    "family" INTEGER NOT NULL,
    "range_start" VARCHAR(32) NOT NULL,
    "range_end" VARCHAR(32) NOT NULL,
    "network" VARCHAR(64),
    "network_name" VARCHAR(200),
    "org_ja" VARCHAR(300),
    "org_en" VARCHAR(300),
    "found" BOOLEAN NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_whois_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ip_whois_family_range_start_idx" ON "ip_whois"("family", "range_start");
