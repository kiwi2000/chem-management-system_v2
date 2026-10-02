/**
 * 既にあるアクセス記録の接続元を、まとめて JPNIC の WHOIS で調べて表（ip_whois）に入れる管理用スクリプト（2026-10-02）。
 *
 * ふだんは、ログインのときと、アクセス記録の画面で開いたページの分だけを裏で調べる。
 * 機能を入れる前の記録や、開いていないページの記録はそのままでは空なので、これで埋める。
 *
 * 実行（アプリの別名 `@/` を解くため、apps/web の tsconfig を渡す）:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-ip-whois.ts          数えるだけ（何も書かない）
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/backfill-ip-whois.ts --run    調べて入れる
 *
 * 調べるのは、外から来た日本のアドレスだけ（画面の裏の調べと同じ決まり）。
 * 1 件ずつ、1 秒あけて問い合わせる。既に調べてあって古くないものは問い合わせない。
 * 書くのは ip_whois だけ。アクセス記録そのものは書き換えない（画面は記録のアドレスで表を引いて出す）
 */
import { PrismaClient } from "@prisma/client";
import { SIGNIN_ACTIONS, TAKEOUT_ACTIONS } from "../apps/web/lib/access-log-shared";
import { clientIp } from "../apps/web/lib/ip-allow";
import { lookupAndStore, needsWhois, whoisFor } from "../apps/web/lib/ip-whois";

const prisma = new PrismaClient();

async function main() {
  const run = process.argv.includes("--run");
  const actions = [...SIGNIN_ACTIONS, ...TAKEOUT_ACTIONS];

  // 記録の中のアドレスを集める（行が多いので区切って読む）
  const ips = new Set<string>();
  let rows = 0;
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.auditLog.findMany({
      where: { action: { in: actions } },
      select: { id: true, diff: true },
      orderBy: { id: "asc" },
      take: 2000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const r of batch) {
      const ip = ((r.diff ?? {}) as { ip?: unknown }).ip;
      // 古い記録には「相手, 中継」の並びのまま入っているものがある。先頭が相手
      const first = typeof ip === "string" ? clientIp(ip) : null;
      if (first) ips.add(first);
    }
    rows += batch.length;
    cursor = batch[batch.length - 1]!.id;
  }
  const targets = [...ips].filter(needsWhois);
  const cached = await whoisFor(targets);
  const todo = targets.filter((ip) => !cached.get(ip) || cached.get(ip)!.stale);
  console.log(
    `記録 ${rows} 行 / アドレス ${ips.size} 種類 / 日本のアドレス ${targets.length} / 調べ済み ${targets.length - todo.length} / これから調べる ${todo.length}`,
  );
  if (!run) {
    console.log("（数えただけ。--run を付けると調べて入れる）");
    return;
  }

  const count = { cached: 0, found: 0, none: 0, failed: 0, skipped: 0 };
  for (const [i, ip] of todo.entries()) {
    const result = await lookupAndStore(ip);
    count[result]++;
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1} / ${todo.length}`);
  }
  console.log(
    `済み: 見つかった ${count.found} / JPNIC に無い ${count.none} / 同じ範囲で調べ済み ${count.cached} / 失敗 ${count.failed}`,
  );
  const sample = await whoisFor(targets);
  for (const ip of targets.slice(0, 30)) {
    const w = sample.get(ip)?.info;
    console.log(
      `  ${ip} → ${w ? (w.found ? `${w.orgJa ?? w.orgEn ?? ""} (${w.networkName ?? ""})` : "JPNIC に無い") : "未"}`,
    );
  }
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
