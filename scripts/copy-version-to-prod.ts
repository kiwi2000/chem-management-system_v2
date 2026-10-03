/**
 * ローカルで作った**1 つの版**の法規制データだけを、本番へ写す（2026-10-03。LOLI 2026Q4 を本番へ入れるために作った）。
 *
 *   railway connect Postgres --tunnel-only        別の窓で開いておく（SDS あり版は Postgres-3z1K）
 *   （出てきた URL を .cache/prod.env に PROD_URL=… として書く）
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/copy-version-to-prod.ts 2026Q4            下見
 *   ... scripts/copy-version-to-prod.ts 2026Q4 --write   書き込み
 *
 * `copy-to-prod.ts` はローカルにあって本番に無いものを**全部**足すので、試験用の版・見本の製品・
 * ローカルだけの前の版のリンクまで入ってしまう。こちらは指定した版のぶんだけを写す。
 *
 * 写すもの（どれも足すだけ。本番にある行は消さない・書き換えない）
 *   版（本番に無ければ。**現在の版にはしない**）→ 版 × データソース
 *   → その版のリンクが指す法文物質名で本番に無いもの（分類は本番にあるものに付ける）
 *   → 物質マスタ（リンクから自動で作った `CAS-…` のもので、本番に無いもの）
 *   → その版のインベントリの行 → その版の CAS リンク
 * 写さないもの: リンクに添える文章（`statutory_cas_link_data`）。本番に向けて `seed-link-data.ts <版>` を流す
 *
 * id はローカルのものを持っていく（本番に無い行だけを足すので、ぶつからない）。途中で止まっても、もう一度流せば続きから入る
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const versionCode = process.argv.slice(2).find((a) => /^\d{4}Q\d$/i.test(a));
if (!versionCode) throw new Error("版を 2026Q4 のように指定してください");
const write = process.argv.includes("--write");

const prodUrl = readFileSync(".cache/prod.env", "utf-8")
  .trim()
  .replace(/^PROD_URL=/, "");
const localUrl = /DATABASE_URL="?([^"\n\r]+)"?/.exec(readFileSync(".env", "utf-8"))![1];
const L = new PrismaClient({ datasources: { db: { url: localUrl } } });
const P = new PrismaClient({ datasources: { db: { url: prodUrl } } });
/** 1 回の INSERT に載せる行数。トンネル越しなので大きすぎると詰まる */
const CHUNK = 5000;
const log = (s: string) => console.log(s);

function progress(label: string, done: number, total: number) {
  const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
  process.stdout.write(`\r  ${label} ${done}/${total} (${pct}%)   `);
  if (done >= total) process.stdout.write("\n");
}

async function main() {
  const code = versionCode!.toUpperCase();
  log(`${write ? "本番へ書き込みます" : "下見（--write で書き込み）"}: 版 ${code}\n`);
  const lv = await L.linkSetVersion.findFirstOrThrow({ where: { codeNormalized: code } });

  // ── データソース（コードで対応づける） ──
  const pSource = new Map(
    (await P.source.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.codeNormalized,
      x.id,
    ]),
  );
  const lSource = new Map(
    (await L.source.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.id,
      x.codeNormalized,
    ]),
  );
  const srcOf = (localId: string) => pSource.get(lSource.get(localId)!);

  // ── 版 ──
  let pv = await P.linkSetVersion.findFirst({ where: { codeNormalized: code } });
  if (pv) log(`  版 ${code} は本番にあります`);
  else if (write) {
    pv = await P.linkSetVersion.create({
      data: { ...lv, isCurrent: false, currentPinned: false, createdBy: null, updatedBy: null },
    });
    log(
      `  版 ${code} を作りました（基準日 ${lv.asOf.toISOString().slice(0, 10)}。現在の版にはしていません）`,
    );
  } else log(`  版 ${code} を作る予定（基準日 ${lv.asOf.toISOString().slice(0, 10)}）`);

  // ── 版 × データソース ──
  const lLvs = await L.linkVersionSource.findMany({ where: { versionId: lv.id } });
  for (const x of lLvs) {
    const sid = srcOf(x.sourceId);
    if (!sid) throw new Error(`データソース ${lSource.get(x.sourceId)} が本番にありません`);
    const exists =
      pv && (await P.linkVersionSource.findFirst({ where: { versionId: pv.id, sourceId: sid } }));
    if (exists) continue;
    if (write) {
      await P.linkVersionSource.create({ data: { ...x, versionId: pv!.id, sourceId: sid } });
      log(`  版 × ${lSource.get(x.sourceId)} を作りました`);
    } else log(`  版 × ${lSource.get(x.sourceId)} を作る予定`);
  }

  // ── 法文物質名の対応（法令/区分/分類/法文物質名のコードの道筋で決まる） ──
  type Path = {
    id: string;
    lawCode: string;
    catCode: string;
    clsCode: string;
    subCode: string;
    classId: string;
  };
  const pathSql = `
    SELECT ss.id, ss.class_id AS "classId",
           l.code_normalized AS "lawCode", c.code_normalized AS "catCode",
           rc.code_normalized AS "clsCode", ss.code_normalized AS "subCode"
    FROM statutory_substances ss
    JOIN regulation_classes rc ON rc.id = ss.class_id
    JOIN regulation_categories c ON c.id = rc.category_id
    JOIN laws l ON l.id = c.law_id`;
  const keyOf = (r: Path) => `${r.lawCode}/${r.catCode}/${r.clsCode}/${r.subCode}`;
  const clsKeyOf = (r: Path) => `${r.lawCode}/${r.catCode}/${r.clsCode}`;
  const pPaths = (await P.$queryRawUnsafe(pathSql)) as Path[];
  const lPaths = (await L.$queryRawUnsafe(pathSql)) as Path[];
  const prodSubOf = new Map(pPaths.map((r) => [keyOf(r), r.id]));
  const prodClassOf = new Map(pPaths.map((r) => [clsKeyOf(r), r.classId]));
  const pClasses = (await P.$queryRawUnsafe(`
    SELECT rc.id, l.code_normalized AS "lawCode", c.code_normalized AS "catCode", rc.code_normalized AS "clsCode"
    FROM regulation_classes rc JOIN regulation_categories c ON c.id = rc.category_id JOIN laws l ON l.id = c.law_id`)) as {
    id: string;
    lawCode: string;
    catCode: string;
    clsCode: string;
  }[];
  for (const c of pClasses) prodClassOf.set(`${c.lawCode}/${c.catCode}/${c.clsCode}`, c.id);
  const localPath = new Map(lPaths.map((r) => [r.id, r]));

  // その版のリンクが指す法文物質名のうち、本番に無いもの
  const usedSubIds = (
    await L.statutoryCasLink.groupBy({ by: ["statutorySubstanceId"], where: { versionId: lv.id } })
  ).map((g) => g.statutorySubstanceId);
  const newSubs = usedSubIds
    .map((id) => localPath.get(id)!)
    .filter((p) => p && !prodSubOf.has(keyOf(p)));
  const noClass = newSubs.filter((p) => !prodClassOf.has(clsKeyOf(p)));
  log(
    `  法文物質名: リンクが指すもの ${usedSubIds.length} 件 / 本番に無いもの ${newSubs.length} 件${noClass.length ? `（分類が本番に無く写せない ${noClass.length} 件: ${noClass.slice(0, 5).map(keyOf).join(", ")}）` : ""}`,
  );
  if (newSubs.length > 0) {
    for (const p of newSubs.slice(0, 10)) log(`    ${keyOf(p)}`);
  }
  if (write && newSubs.length > noClass.length) {
    const rows = await L.statutorySubstance.findMany({
      where: { id: { in: newSubs.filter((p) => prodClassOf.has(clsKeyOf(p))).map((p) => p.id) } },
    });
    const r = await P.statutorySubstance.createMany({
      data: rows.map((s) => ({ ...s, classId: prodClassOf.get(clsKeyOf(localPath.get(s.id)!))! })),
      skipDuplicates: true,
    });
    log(`    ${r.count} 件を足しました`);
    for (const s of rows) prodSubOf.set(keyOf(localPath.get(s.id)!), s.id);
  }

  // ── 物質マスタ（リンクから自動で作った CAS-… で、本番に無いもの） ──
  const pSubstCode = new Set(
    (await P.substance.findMany({ select: { codeNormalized: true } })).map((x) => x.codeNormalized),
  );
  const lAuto = await L.substance.findMany({
    where: { codeNormalized: { startsWith: "CAS-" }, deletedAt: null },
  });
  const addSubst = lAuto.filter((x) => !pSubstCode.has(x.codeNormalized));
  log(`  物質マスタ（CAS-…）: 本番に無いもの ${addSubst.length} 件`);
  if (write && addSubst.length > 0) {
    let added = 0;
    for (let i = 0; i < addSubst.length; i += CHUNK) {
      const r = await P.substance.createMany({
        data: addSubst.slice(i, i + CHUNK).map((s) => ({ ...s, createdBy: null, updatedBy: null })),
        skipDuplicates: true,
      });
      added += r.count;
    }
    log(`    ${added} 件を足しました`);
  }

  // ── インベントリの行（目録ごと。本番の件数がローカルより少なければ続きから） ──
  const pInv = new Map(
    (await P.inventory.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.codeNormalized,
      x.id,
    ]),
  );
  for (const inv of await L.inventory.findMany()) {
    const n = await L.inventoryRow.count({ where: { inventoryId: inv.id, versionId: lv.id } });
    if (n === 0) continue;
    const pid = pInv.get(inv.codeNormalized);
    if (!pid) {
      log(`  インベントリ ${inv.code}: 本番に目録が無いので写せません（${n} 行）`);
      continue;
    }
    const already = pv
      ? await P.inventoryRow.count({ where: { inventoryId: pid, versionId: pv.id } })
      : 0;
    if (already >= n) {
      log(`  インベントリ ${inv.code} 済み（${already} 行）`);
      continue;
    }
    if (!write) {
      log(
        `  インベントリ ${inv.code} ${n - already} 行を足す予定${already ? `（途中から ${already}/${n}）` : ""}`,
      );
      continue;
    }
    let done = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await L.inventoryRow.findMany({
        where: { inventoryId: inv.id, versionId: lv.id },
        take: CHUNK,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;
      await P.inventoryRow.createMany({
        data: batch.map((r) => ({
          ...r,
          inventoryId: pid,
          versionId: pv!.id,
          sourceId: srcOf(r.sourceId)!,
        })),
        skipDuplicates: true,
      });
      done += batch.length;
      progress(`インベントリ ${inv.code}`, done, n);
    }
  }

  // ── CAS リンク（法令ごと。本番の件数がローカルより少なければ続きから） ──
  const lawOf = (subId: string) => localPath.get(subId)?.lawCode ?? "?";
  const byLaw = new Map<string, string[]>();
  for (const id of usedSubIds) byLaw.set(lawOf(id), [...(byLaw.get(lawOf(id)) ?? []), id]);
  let skipped = 0;
  for (const [law, subIds] of [...byLaw].sort()) {
    const n = await L.statutoryCasLink.count({
      where: { versionId: lv.id, statutorySubstanceId: { in: subIds } },
    });
    const prodIds = subIds
      .map((id) => prodSubOf.get(keyOf(localPath.get(id)!)))
      .filter((x): x is string => !!x);
    const already = pv
      ? await P.statutoryCasLink.count({
          where: { versionId: pv.id, statutorySubstanceId: { in: prodIds } },
        })
      : 0;
    if (already >= n) {
      log(`  リンク ${law} 済み（${already} 件）`);
      continue;
    }
    if (!write) {
      log(
        `  リンク ${law} ${n - already} 件を足す予定${already ? `（途中から ${already}/${n}）` : ""}`,
      );
      continue;
    }
    let done = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await L.statutoryCasLink.findMany({
        where: { versionId: lv.id, statutorySubstanceId: { in: subIds } },
        take: CHUNK,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1]!.id;
      const data = [];
      for (const r of batch) {
        const id = prodSubOf.get(keyOf(localPath.get(r.statutorySubstanceId)!));
        if (!id) {
          skipped++;
          continue;
        }
        data.push({
          ...r,
          statutorySubstanceId: id,
          versionId: pv!.id,
          sourceId: srcOf(r.sourceId)!,
        });
      }
      if (data.length > 0) await P.statutoryCasLink.createMany({ data, skipDuplicates: true });
      done += batch.length;
      progress(`リンク ${law}`, done, n);
    }
  }
  if (skipped > 0) log(`  対応する法文物質名が本番に無く、飛ばしたリンク: ${skipped} 件`);
  log("\n終わりました。リンクに添える文章は seed-link-data.ts を本番に向けて流す");
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await L.$disconnect();
    await P.$disconnect();
  });
