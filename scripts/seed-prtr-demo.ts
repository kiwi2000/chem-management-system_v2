/**
 * PRTR の届出データ入力を見せるためのサンプルを、本番などの既にある DB に入れる管理用スクリプト（2026-10-02）。
 *
 * scripts/seed-prtr-sample.ts は開発用の見本の物質（CH-TOL など）を前提にしているが、
 * こちらは**物質を CAS で探す**ので、物質コードの付けかたが違う DB にも入れられる。
 *
 * 実行（アプリの別名 `@/` を解くため、apps/web の tsconfig を渡す）:
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/seed-prtr-demo.ts --user <表示名> --org <所属名> [--org <所属名> ...] [--fy 2025]
 *       … 何を入れるかを数えるだけ（何も書かない）
 *   ... 同じ引数に --run   … 入れる
 *   ... scripts/seed-prtr-demo.ts --remove [--org <所属名> ...] [--fy 2025] --run   … 入れたものを消す
 *
 * 入れるもの:
 *  - 製品 120 件（コード PRTR-P001〜）。塗料・シンナー・接着剤など。組成は化管法 第一種に当たる物質 1〜3 行
 *    ＋当たらない物質 0〜1 行。組成を展開して判定まで流す（排出量集計に含有率が要るため）
 *  - 指定した所属 × 年度の届出データに、物質収支・排出係数・実測値の行。排出係数の区画は、
 *    その届出データに排出係数が入っているときだけ入れる（頭の設定は変えない）
 *  - 既にある行には触れない。届出データの頭が無ければ作る。集計が確定している届出データには入れない
 *  - 行の登録者・製品の作成者は --user の人
 *
 * 消すとき: PRTR-P の製品の数量・組成・判定・展開・製品と、指定した届出データの実測値のうち
 * このスクリプトが使う物質の行を消す
 *
 * 値は乱数で作るが、種を固定してあるので流し直しても同じになる
 */
import { normalizeCode } from "@chem/shared";
import { Prisma, PrismaClient } from "@prisma/client";

/*
  トンネル越しに本番へ流すと往復が遅く、判定の 1 回のまとまり（既定 5 秒）に収まらない。
  アプリの部品（lib/db.ts）は globalThis に先に置いたものを使うので、上限を延ばしたものを置いておく
*/
const prisma = new PrismaClient({ transactionOptions: { timeout: 120_000, maxWait: 30_000 } });
(globalThis as unknown as { prisma?: PrismaClient }).prisma = prisma;
const PREFIX = "PRTR-P";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const rand = rng(20261002);
const between = (lo: number, hi: number, digits = 1) => (lo + rand() * (hi - lo)).toFixed(digits);

/** 使う物質（CAS）。第一種に当たるものと、当たらない詰め物 */
const CAS = {
  TOL: "108-88-3",
  XYL: "1330-20-7",
  EB: "100-41-4",
  MIBK: "108-10-1",
  HCHO: "50-00-0",
  HDI: "822-06-0",
  DBTDL: "77-58-7",
  STY: "100-42-5",
  TMB: "95-63-6",
  DCM: "75-09-2",
  HEX: "110-54-3",
  DEHP: "117-81-7",
  BAC: "123-86-4",
  CB: "1333-86-4",
  BASO4: "7727-43-7",
  BUOH: "71-36-3",
  TIO2: "13463-67-7",
  CACO3: "471-34-1",
} as const;
type Key = keyof typeof CAS;

const KINDS: { name: string; codes: Key[]; filler: Key[]; nos: string[] }[] = [
  {
    name: "溶剤系塗料",
    codes: ["TOL", "XYL", "EB", "MIBK"],
    filler: ["BAC", "CB", "TIO2"],
    nos: ["白", "黒", "グレー", "赤さび", "黄", "青"],
  },
  {
    name: "2液ウレタン塗料 主剤",
    codes: ["XYL", "EB", "TOL"],
    filler: ["BAC", "BUOH", "TIO2"],
    nos: ["白", "黒", "グレー", "緑"],
  },
  {
    name: "2液ウレタン塗料 硬化剤",
    codes: ["HDI", "XYL"],
    filler: ["BAC"],
    nos: ["標準", "速乾", "冬型"],
  },
  {
    name: "エポキシプライマー",
    codes: ["XYL", "EB", "TOL"],
    filler: ["BUOH", "BASO4"],
    nos: ["赤さび", "グレー", "白"],
  },
  {
    name: "ラッカーシンナー",
    codes: ["TOL", "XYL", "MIBK"],
    filler: ["BAC", "BUOH"],
    nos: ["T-100", "T-200", "T-300", "冬用"],
  },
  {
    name: "ウレタンシンナー",
    codes: ["XYL", "EB", "TMB"],
    filler: ["BAC", "BUOH"],
    nos: ["U-10", "U-20", "U-30"],
  },
  {
    name: "洗浄用シンナー",
    codes: ["TOL", "XYL", "HEX"],
    filler: ["BAC"],
    nos: ["C-90", "C-50", "リサイクル"],
  },
  {
    name: "接着剤（溶剤形）",
    codes: ["TOL", "MIBK", "HEX"],
    filler: ["BAC", "CACO3"],
    nos: ["G-17", "G-103", "速乾"],
  },
  { name: "接着剤（水性）", codes: ["HCHO"], filler: ["BUOH", "CACO3"], nos: ["W-1", "W-2"] },
  {
    name: "樹脂ワニス",
    codes: ["XYL", "EB", "HCHO", "STY"],
    filler: ["BAC", "BUOH"],
    nos: ["V-10", "V-20", "耐熱"],
  },
  { name: "剥離剤", codes: ["DCM"], filler: ["BUOH"], nos: ["R-1", "R-2"] },
  {
    name: "印刷インキ",
    codes: ["TOL", "MIBK", "EB"],
    filler: ["BAC", "CB"],
    nos: ["墨", "藍", "紅", "黄"],
  },
  { name: "軟質塩ビ用可塑剤配合品", codes: ["DEHP"], filler: ["CACO3"], nos: ["P-1", "P-2"] },
  { name: "FRP 用樹脂", codes: ["STY"], filler: ["CACO3", "TIO2"], nos: ["一般", "難燃"] },
  {
    name: "床用コーティング",
    codes: ["XYL", "EB", "DBTDL"],
    filler: ["BAC", "BASO4"],
    nos: ["標準", "重歩行"],
  },
];

/** 実測値の区画に入れる物質（排出を測っている想定） */
const MEASURED: Key[] = ["TOL", "XYL", "DCM", "STY", "HCHO", "EB"];

interface ProductSeed {
  code: string;
  name: string;
  lines: { key: Key; pct: string }[];
}

function buildProducts(): ProductSeed[] {
  const out: ProductSeed[] = [];
  for (let i = 1; i <= 120; i++) {
    const kind = KINDS[(i - 1) % KINDS.length]!;
    const no = kind.nos[Math.floor((i - 1) / KINDS.length) % kind.nos.length]!;
    const n = 1 + Math.floor(rand() * Math.min(3, kind.codes.length));
    const chosen = [...kind.codes].sort(() => rand() - 0.5).slice(0, n);
    const lines: { key: Key; pct: string }[] = [];
    let total = 0;
    for (const c of chosen) {
      const pct = Number(between(2, 35, 1));
      if (total + pct > 90) break;
      lines.push({ key: c, pct: pct.toFixed(1) });
      total += pct;
    }
    if (rand() < 0.7) {
      const f = kind.filler[Math.floor(rand() * kind.filler.length)]!;
      lines.push({ key: f, pct: between(5, Math.max(6, 95 - total), 1) });
    }
    out.push({
      code: `${PREFIX}${String(i).padStart(3, "0")}`,
      name: `${kind.name} ${no} ${100 + i}`,
      lines,
    });
  }
  return out;
}

function args() {
  const a = process.argv.slice(2);
  const all = (flag: string) => a.flatMap((v, i) => (v === flag && a[i + 1] ? [a[i + 1]!] : []));
  const fy = Number(
    all("--fy")[0] ?? new Date().getFullYear() - (new Date().getMonth() + 1 >= 4 ? 1 : 2),
  );
  return {
    run: a.includes("--run"),
    remove: a.includes("--remove"),
    orgs: all("--org"),
    user: all("--user")[0],
    fy,
  };
}

/** 物質の id → コード（実測値の物質を第一種指定化学物質に当てるのに使う） */
const codesById = new Map<string, string>();

/** CAS → 物質。公開済みで、削除されていないもの。複数あればコードの順で先頭 */
async function substancesByCas(): Promise<Map<Key, string>> {
  const out = new Map<Key, string>();
  codesById.clear();
  for (const [k, cas] of Object.entries(CAS) as [Key, string][]) {
    const s = await prisma.substance.findFirst({
      where: { casNormalized: cas, deletedAt: null, publishState: "PUBLISHED" },
      orderBy: { code: "asc" },
      select: { id: true, code: true },
    });
    if (!s) throw new Error(`CAS ${cas} の公開済みの物質がありません`);
    out.set(k, s.id);
    codesById.set(s.id, s.code);
  }
  return out;
}

async function entriesFor(orgNames: string[], fy: number, userId: string | null, create: boolean) {
  const out = [];
  for (const name of orgNames) {
    const org = await prisma.organisation.findFirst({
      where: { nameJa: name },
      select: { id: true },
    });
    if (!org) throw new Error(`所属「${name}」がありません`);
    let entry = await prisma.prtrEntry.findUnique({
      where: { organisationId_fiscalYear: { organisationId: org.id, fiscalYear: fy } },
      include: { summary: { select: { confirmedAt: true } } },
    });
    if (!entry && create) {
      entry = await prisma.prtrEntry.create({
        data: { organisationId: org.id, fiscalYear: fy, createdBy: userId, updatedBy: userId },
        include: { summary: { select: { confirmedAt: true } } },
      });
    }
    out.push({ name, entry });
  }
  return out;
}

async function remove(orgNames: string[], fy: number, run: boolean) {
  const products = await prisma.product.findMany({
    where: { code: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = products.map((p) => p.id);
  const subs = await substancesByCas();
  const measuredSubIds = MEASURED.map((k) => subs.get(k)!);
  const entries = (await entriesFor(orgNames, fy, null, false)).flatMap((e) =>
    e.entry ? [e.entry.id] : [],
  );
  const q = await prisma.prtrQuantity.count({ where: { productId: { in: ids } } });
  const m = await prisma.prtrMeasured.count({
    where: { entryId: { in: entries }, substanceId: { in: measuredSubIds } },
  });
  console.log(`消す: 製品 ${ids.length} 件（数量 ${q} 行）/ 実測値 ${m} 行`);
  if (!run) return console.log("（数えただけ。--run を付けると消す）");
  await prisma.prtrQuantity.deleteMany({ where: { productId: { in: ids } } });
  await prisma.prtrMeasured.deleteMany({
    where: { entryId: { in: entries }, substanceId: { in: measuredSubIds } },
  });
  await prisma.compositionLine.deleteMany({ where: { parentProductId: { in: ids } } });
  await prisma.productJudgement.deleteMany({ where: { productId: { in: ids } } });
  await prisma.productExpansion.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  console.log("消しました");
}

async function seed(orgNames: string[], fy: number, userName: string | undefined, run: boolean) {
  if (orgNames.length === 0) throw new Error("--org <所属名> を 1 つ以上");
  if (!userName) throw new Error("--user <表示名>（登録者・作成者にする人）");
  const user = await prisma.user.findFirst({
    where: { displayName: userName, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new Error(`利用者「${userName}」がいません`);
  const subs = await substancesByCas();
  const products = buildProducts();
  const existing = await prisma.product.count({ where: { code: { startsWith: PREFIX } } });
  const entries = await entriesFor(orgNames, fy, user.id, false);

  // 所属ごとに、どの製品をどの区画に入れるか（所属ごとにずらす）
  const plans = entries.map((e, idx) => {
    const offset = idx * 40;
    const pickRange = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => products[(offset + from + i) % products.length]!);
    const hasFactor = e.entry?.factorPct != null;
    return {
      ...e,
      balance: pickRange(0, hasFactor ? 70 : 80),
      factor: hasFactor ? pickRange(70, 35) : [],
      measured: MEASURED.slice(0, hasFactor ? 6 : 4),
    };
  });
  console.log(`製品: ${products.length} 件を作る（既にある PRTR-P: ${existing} 件）`);
  for (const p of plans) {
    const confirmed = p.entry?.summary?.confirmedAt != null;
    console.log(
      `${p.name} ${fy} 年度: 頭 ${p.entry ? "あり" : "なし（作る）"}${confirmed ? "・確定中（入れない）" : ""} / 物質収支 ${p.balance.length} / 排出係数 ${p.factor.length}${p.factor.length === 0 ? "（排出係数が空なので入れない）" : ""} / 実測値 ${p.measured.length}`,
    );
  }
  if (!run) return console.log("（数えただけ。--run を付けると入れる）");
  if (plans.some((p) => p.entry?.summary?.confirmedAt != null))
    throw new Error("確定中の届出データがあります");

  // ── 製品と組成 ──
  const productIds = new Map<string, string>();
  for (const p of products) {
    const codeNormalized = normalizeCode(p.code);
    const found = await prisma.product.findUnique({
      where: { codeNormalized },
      select: { id: true },
    });
    const row = found
      ? await prisma.product.update({
          where: { id: found.id },
          data: { nameJa: p.name, nameEn: p.name, deletedAt: null },
          select: { id: true },
        })
      : await prisma.product.create({
          data: {
            code: p.code,
            codeNormalized,
            nameJa: p.name,
            nameEn: p.name,
            status: "ACTIVE",
            publishState: "PUBLISHED",
            usableAsMaterial: false,
            createdBy: user.id,
            updatedBy: user.id,
          },
          select: { id: true },
        });
    await prisma.compositionLine.deleteMany({ where: { parentProductId: row.id } });
    await prisma.compositionLine.createMany({
      data: p.lines.map((l, i) => ({
        parentProductId: row.id,
        substanceId: subs.get(l.key)!,
        contentPct: l.pct,
        displayOrder: i + 1,
      })),
    });
    productIds.set(p.code, row.id);
  }
  console.log(`製品 ${productIds.size} 件と組成を入れました。展開と判定を流します`);

  // ── 展開と判定（組成の保存と同じ。法律側の決めごとは 1 回だけ読む） ──
  const { expandProduct, saveExpansion } = await import("../apps/web/lib/expansion-store");
  const { loadRules, loadFactors, judgeProduct } = await import("../apps/web/lib/judge-store");
  const { todayInJapan } = await import("../apps/web/lib/judgement-date");
  const { getAppSettings } = await import("../apps/web/lib/settings");
  const version = await prisma.linkSetVersion.findFirst({
    where: { isCurrent: true },
    select: { id: true },
  });
  if (!version) throw new Error("現在の法規制バージョンがありません");
  const asOf = todayInJapan();
  const rules = await loadRules(version.id, asOf);
  const factors = await loadFactors();
  const { conditionalLinkMode } = await getAppSettings();
  let applicable = 0;
  let skipped = 0;
  for (const [i, id] of [...productIds.values()].entries()) {
    // 流し直したとき、今日すでに判定してある製品は飛ばす（トンネル越しだと 1 件 30 秒ほどかかる）
    const done = await prisma.productJudgementRun.findFirst({
      where: { productId: id, versionId: version.id, judgedAsOf: new Date(`${asOf}T00:00:00Z`) },
      select: { id: true },
    });
    const expanded = await prisma.productExpansion.findUnique({
      where: { productId: id },
      select: { productId: true },
    });
    if (done && expanded) {
      skipped++;
      continue;
    }
    await saveExpansion(id, await expandProduct(id));
    const r = await judgeProduct(id, rules, factors, {
      asOf,
      trigger: "SCRIPT",
      conditionalLinkMode,
      versionId: version.id,
      actorId: user.id,
    });
    if (r.applicable > 0) applicable++;
    if ((i + 1) % 20 === 0) console.log(`  判定 ${i + 1} / ${productIds.size}`);
  }
  console.log(
    `判定しました（どれかの区分に該当: ${applicable} 件。今日判定済みで飛ばした: ${skipped} 件）`,
  );

  // ── 届出データ ──
  const { resolveMeasuredSubstance } = await import("../apps/web/lib/prtr-service");
  for (const p of plans) {
    const entry = p.entry ?? (await entriesFor([p.name], fy, user.id, true))[0]!.entry!;
    const quantity = (method: "BALANCE" | "FACTOR", code: string) => {
      const purchased = Number(between(120, 25000, 0));
      const shipped = Math.round(purchased * (0.55 + rand() * 0.4));
      return {
        entryId: entry.id,
        method,
        productId: productIds.get(code)!,
        purchasedKg: new Prisma.Decimal(purchased),
        shippedKg: new Prisma.Decimal(shipped),
        source: "MANUAL" as const,
        updatedBy: user.id,
      };
    };
    const q = await prisma.prtrQuantity.createMany({
      data: [
        ...p.balance.map((x) => quantity("BALANCE", x.code)),
        ...p.factor.map((x) => quantity("FACTOR", x.code)),
      ],
      skipDuplicates: true,
    });
    let m = 0;
    for (const k of p.measured) {
      const substanceId = subs.get(k)!;
      const resolved = await resolveMeasuredSubstance(codesById.get(substanceId)!);
      if (!resolved.ok) continue;
      const statutorySubstanceId = resolved.statutorySubstanceId;
      const dup = await prisma.prtrMeasured.findFirst({
        where: { entryId: entry.id, statutorySubstanceId },
      });
      if (dup) continue;
      await prisma.prtrMeasured.create({
        data: {
          entryId: entry.id,
          statutorySubstanceId,
          substanceId,
          handledKg: rand() < 0.7 ? new Prisma.Decimal(between(100, 6000, 1)) : null,
          measuredKg: new Prisma.Decimal(between(0.5, 480, 1)),
          source: "MANUAL",
          updatedBy: user.id,
        },
      });
      m++;
    }
    console.log(`${p.name} ${fy} 年度: 数量 ${q.count} 行・実測値 ${m} 行を入れました`);
  }
}

async function main() {
  const a = args();
  if (a.remove) return remove(a.orgs, a.fy, a.run);
  return seed(a.orgs, a.fy, a.user, a.run);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
