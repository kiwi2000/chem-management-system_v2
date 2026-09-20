/**
 * 納品用に、お客様が使わない物質を**物理削除**する。
 *
 * お客様は初めてこのシステムを使うので、取り込みで作った 6 万件の物質
 * （`CAS-…` `CHRIP-…`）が最初から並んでいると、自分のものと見分けがつかない。
 * 組成に使っている物質だけを残し、それ以外は行ごと消して痕跡を残さない。
 *
 * **法規制データは消さない。**CAS リンク（statutory_cas_links）は物質 ID を持たず
 * CAS で結んでいるので、物質を消しても判定には影響しない。あとからお客様が
 * 同じ CAS の物質を自分のコードで登録すれば、そのまま該当する。
 * インベントリ・金属換算係数も物質とは別の表で、CAS で引くので残る。
 *
 * ## 使い方
 *
 *   node --env-file=<納品用DBの.env> node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/handover-purge-substances.ts                 下見（何も消さない）
 *   CHEM_HANDOVER_DB=<DB名> node --env-file=<納品用DBの.env> ... scripts/handover-purge-substances.ts --write
 *
 *   --keep-no-cas   CAS を持たない物質（`CHRIP-…` の独自コードを CAS 欄に持つ UVCB など）は
 *                   登録し直せないので残す。お客様が石油留分などを使うときだけ
 *
 * ## 二重の鍵（開発用DBと本番を守る）
 *
 * 1. `--write` が無ければ何も消さない
 * 2. `--write` でも、環境変数 CHEM_HANDOVER_DB が DATABASE_URL のデータベース名と
 *    一致しなければ止まる。開発用（chem_v2）や Railway に向いたまま流しても消えない
 * 3. Railway のホスト（railway.internal / rlwy.net）は名前が一致しても断る
 *
 * ## 納品の流れ
 *
 * 1. 開発用DBのバックアップを、納品用の別DB（例 chem_handover）に戻す
 * 2. お客様の物質をお客様のコードで、製品と組成もその DB に入れる
 * 3. このスクリプトを下見 → `--write`
 * 4. 展開結果は消してあるので、起動後に「全製品の再計算」
 * 5. その DB をバックアップして、インストールセットに載せる
 *
 * ## 消すもの
 *
 *   物質（別名・官報公示整理番号・物性値は表の定義で連鎖して消える）
 *   その物質を指している展開結果の行（再計算で作り直すもの）
 *   その物質の監査ログ（コードが diff に残るため）
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** `1333-86-4` の形。これ以外を CAS 欄に持つ物質は「CAS を持たない物質」 */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

function dbNameOf(url: string | undefined): { host: string; db: string } {
  if (!url) throw new Error("DATABASE_URL が無い");
  const u = new URL(url);
  return { host: u.hostname, db: u.pathname.replace(/^\//, "") };
}

function prefixOf(code: string): string {
  if (code.startsWith("CAS-")) return "CAS-（取り込みで作ったもの）";
  if (code.startsWith("CHRIP-")) return "CHRIP-（CAS の無い物質）";
  return "それ以外のコード";
}

async function main() {
  const write = process.argv.includes("--write");
  const keepNoCas = process.argv.includes("--keep-no-cas");
  const { host, db } = dbNameOf(process.env.DATABASE_URL);
  console.log(`対象: ${host} / ${db}   ${write ? "消します" : "下見（--write で実行）"}`);

  if (write) {
    if (/railway\.internal|rlwy\.net/i.test(host)) {
      throw new Error("Railway（公開検証環境）には流さない");
    }
    if (process.env.CHEM_HANDOVER_DB !== db) {
      throw new Error(
        `環境変数 CHEM_HANDOVER_DB（${process.env.CHEM_HANDOVER_DB ?? "未設定"}）が ` +
          `DATABASE_URL のデータベース名（${db}）と違う。納品用の DB に向いているか確かめてから、その名前を入れる`,
      );
    }
  }

  // 組成に使われている物質は残す。消したら製品の組成が壊れる
  const used = new Set(
    (
      await prisma.compositionLine.findMany({
        where: { substanceId: { not: null } },
        select: { substanceId: true },
        distinct: ["substanceId"],
      })
    ).map((l) => l.substanceId as string),
  );

  // 論理削除済みも含めて全部見る（痕跡を残さないため）
  const all = await prisma.substance.findMany({
    select: { id: true, code: true, casNormalized: true, nameJa: true, deletedAt: true },
    orderBy: { code: "asc" },
  });

  const keep: typeof all = [];
  const drop: typeof all = [];
  for (const s of all) {
    if (used.has(s.id)) keep.push(s);
    else if (keepNoCas && (!s.casNormalized || !CAS_SHAPE.test(s.casNormalized))) keep.push(s);
    else drop.push(s);
  }

  console.log(`物質 ${all.length} 件 → 残す ${keep.length} 件 / 消す ${drop.length} 件`);
  const byPrefix = new Map<string, number>();
  for (const s of drop) byPrefix.set(prefixOf(s.code), (byPrefix.get(prefixOf(s.code)) ?? 0) + 1);
  for (const [k, n] of byPrefix) console.log(`  消す: ${k} ${n} 件`);

  // 取り込み由来でないコードを消すときは、目で確かめられるように全部出す
  const odd = drop.filter((s) => prefixOf(s.code) === "それ以外のコード");
  if (odd.length) {
    console.log(`\n  取り込み由来でないコードも消す（組成に使われていないため）:`);
    for (const s of odd)
      console.log(`    ${s.code}  ${s.nameJa ?? ""}${s.deletedAt ? "  （論理削除済み）" : ""}`);
  }
  console.log(`\n残す物質:`);
  for (const s of keep)
    console.log(`    ${s.code}  ${s.nameJa ?? ""}  ${s.casNormalized ?? "（CAS なし）"}`);

  // 消す側は 6 万件あって 1 つの問い合わせに入らない（Postgres の変数上限 32,767）。
  // 残す側は数十件なので、「残す ID 以外」で絞る
  const keepIds = keep.map((s) => s.id);
  const gone = { notIn: keepIds };
  const [expLines, logs] = await Promise.all([
    prisma.productExpansionLine.count({ where: { substanceId: { ...gone, not: null } } }),
    prisma.auditLog.count({ where: { entity: "substance", entityId: { ...gone, not: null } } }),
  ]);
  console.log(`\n一緒に消すもの: 展開結果の行 ${expLines} 件 / 監査ログ ${logs} 件`);

  if (!write) {
    console.log("\n下見だけ。書き込むなら CHEM_HANDOVER_DB=<DB名> を付けて --write");
    return;
  }
  if (!drop.length) {
    console.log("消すものが無い");
    return;
  }

  // 展開結果は製品ごとに作り直すものなので、指している行だけでなく製品ぶんを全部消す
  // （残すと「消した物質の行だけ抜けた」中途半端な展開になる）
  const products = await prisma.productExpansionLine.findMany({
    where: { substanceId: { ...gone, not: null } },
    select: { productId: true },
    distinct: ["productId"],
  });
  const productIds = products.map((p) => p.productId);

  await prisma.$transaction(
    async (tx) => {
      if (productIds.length) {
        await tx.productExpansionLine.deleteMany({ where: { productId: { in: productIds } } });
      }
      await tx.auditLog.deleteMany({
        where: { entity: "substance", entityId: { ...gone, not: null } },
      });
      await tx.substance.deleteMany({ where: { id: gone } });
    },
    { timeout: 10 * 60 * 1000 },
  );

  const left = await prisma.substance.count();
  console.log(
    `\n消しました。残っている物質 ${left} 件（展開結果を消した製品 ${productIds.length} 件は、起動後に全製品の再計算）`,
  );
  console.log(
    "消した行の場所が空くだけで中身は残らないが、気になるなら VACUUM FULL substances; を流す",
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
