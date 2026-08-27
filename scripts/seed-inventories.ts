/**
 * 各国のインベントリ（既存化学物質の目録）を取り込む。
 *
 *   npx tsx scripts/seed-inventories.ts <TSV>          下見
 *   npx tsx scripts/seed-inventories.ts <TSV> --write  書き込む
 *
 * **現在のバージョン × LOLI に入れる。**インベントリの行は CASリンクと同じく
 * バージョンとデータソースの管理下にあり、どちらも決まっていないと入れられない。
 * 入れ替えるのも**そのバージョン・そのデータソースのぶんだけ**で、
 * 過去のバージョンと、他のところから取ったぶんには手を触れない。
 *
 * TSV は `scripts/sql/loli-inventories.sql` で取り出す（list_id / cas / data の3列）。
 *
 * **規制区分としては入れない。**
 * 判定は登録されている区分をすべて見に行くので、インベントリを区分として入れると
 * どの製品もすべてのインベントリに「該当」してしまう。
 * インベントリは「載っているか」と「そのインベントリでの番号」を持つだけのもの。
 *
 * **加工してから入れる。**
 * 行が持つのは仕上がった値——番号（`(5)-3714`）か、番号を持たないインベントリの「該当」。
 * 取り出しは取り込みのときに1回で済み、画面は出すだけになる。
 *
 * 取り出しかたは、この表（`INVENTORIES`）の正規表現で決める。
 * 当てるのは `@chem/shared` の `applyExtract`。資料ごとに読み方を書かずに済ませ、
 * **LOLI 以外の資料でも同じ仕組みで扱える**ようにしてある。
 *
 * **1行から複数の番号が取れることがある**（EINECS・KECI）。その数だけ行を作る。
 *
 * インベントリごとに**入れ替える**（前の行を消してから入れる）。
 * 足すだけにすると、LOLI から消えた物質が残り続ける。
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { applyExtract, normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 取り込み元。CASリンクと同じデータソースの表を使う */
const SOURCE_CODE = "LOLI";

interface InventoryDef {
  listId: number;
  code: string;
  country: string;
  nameOriginal: string;
  nameLang: string;
  nameJa: string;
  nameEn: string;
  /**
   * 番号の取り出しかた（正規表現）。**全件一致**で、1行から複数の番号が取れる。
   * null なら番号を取り出さない（載っているかどうかだけ）
   */
  matchPattern: string | null;
  /** 表示の書き方。`$1` などが使える。番号を持たないインベントリは固定の文字 */
  displayFormat: string;
  /** 物質の画面に出すときの見出し。null なら出さない */
  numberLabel: string | null;
}

/**
 * 取り込むインベントリと、番号の取り出しかたの既定値。
 *
 * 正規表現は `Data` の文字列に当てる。実データを見て決めてある
 * （どんな文字列かは docs/LOLI取り込み記録_インベントリ.md）。
 * 画面から直せるので、ここは出発点。
 */
const INVENTORIES: InventoryDef[] = [
  {
    listId: 622,
    code: "ENCS",
    country: "JPN",
    nameOriginal: "既存化学物質名簿・新規公表化学物質",
    nameLang: "JA",
    nameJa: "ENCS（化審法）",
    nameEn: "Existing and New Chemical Substances (ENCS)",
    // (5)-3714 の形。番号の無い行は "-" なので拾わない
    matchPattern: "\\((\\d+)\\)-(\\d+)",
    displayFormat: "($1)-$2",
    numberLabel: "化審法番号（官報公示整理番号）",
  },
  {
    listId: 3830,
    code: "ISHL",
    country: "JPN",
    nameOriginal: "労働安全衛生法 既存化学物質",
    nameLang: "JA",
    nameJa: "ISHL（安衛法）",
    nameEn: "Industrial Safety and Health Law Substances (ISHL)",
    // 中身は ENCS と同じ番号。安衛法のインベントリとしての在否を見るために別に持つ
    matchPattern: "\\((\\d+)\\)-(\\d+)",
    displayFormat: "($1)-$2",
    numberLabel: "安衛法番号",
  },
  {
    listId: 115,
    code: "EINECS",
    country: "EU",
    nameOriginal: "European Inventory of Existing Commercial Chemical Substances",
    nameLang: "EN",
    nameJa: "EINECS（EU既存化学物質）",
    nameEn: "European Inventory of Existing Commercial Chemical Substances (EINECS)",
    // 2xx-xxx-x の形。1つのCASに複数のEC番号が付くことがある
    matchPattern: "(\\d{3}-\\d{3}-\\d)",
    displayFormat: "$1",
    numberLabel: "EC番号",
  },
  {
    listId: 100,
    code: "TSCA",
    country: "USA",
    nameOriginal: "TSCA Section 8(b) Inventory",
    nameLang: "EN",
    nameJa: "TSCA インベントリ",
    nameEn: "TSCA Section 8(b) Inventory",
    /*
      TSCA は番号を持たない（CAS番号そのものが識別子）。
      かわりに **ACTIVE / INACTIVE** を出す。
      INACTIVE は「インベントリには載っているが、いま商業流通していない」という意味なので、
      一律「該当」と出すと、そのまま輸出できるように読まれてしまう。
    */
    matchPattern: "\\((ACTIVE|INACTIVE)\\)",
    displayFormat: "$1",
    numberLabel: "TSCA",
  },
  {
    listId: 101,
    code: "DSL",
    country: "CAN",
    nameOriginal: "Domestic Substances List",
    nameLang: "EN",
    nameJa: "DSL（カナダ国内物質）",
    nameEn: "Domestic Substances List (DSL)",
    matchPattern: null,
    displayFormat: "該当",
    numberLabel: "DSL",
  },
  {
    listId: 102,
    code: "NDSL",
    country: "CAN",
    nameOriginal: "Non-Domestic Substances List",
    nameLang: "EN",
    nameJa: "NDSL（カナダ国外物質）",
    nameEn: "Non-Domestic Substances List (NDSL)",
    matchPattern: null,
    displayFormat: "該当",
    numberLabel: "NDSL",
  },
  {
    listId: 740,
    code: "IECSC",
    country: "CHN",
    nameOriginal: "中国现有化学物质名录",
    nameLang: "ZH",
    nameJa: "IECSC（中国既存化学物質）",
    nameEn: "Inventory of Existing Chemical Substances in China (IECSC)",
    // Present [28742] の形。角括弧の中が序号
    matchPattern: "\\[(\\d+)\\]",
    displayFormat: "$1",
    numberLabel: "IECSC 序号",
  },
  {
    listId: 633,
    code: "KECI",
    country: "KOR",
    nameOriginal: "기존화학물질목록",
    nameLang: "KO",
    nameJa: "KECI（韓国既存化学物質）",
    nameEn: "Korea Existing Chemicals Inventory (KECI)",
    // KE-05780 の形。1つのCASに複数付くことがある
    matchPattern: "(KE-\\d+)",
    displayFormat: "$1",
    numberLabel: "KE番号",
  },
  {
    listId: 6575,
    code: "TCSI",
    country: "TWN",
    nameOriginal: "臺灣化學物質清單",
    nameLang: "ZH",
    nameJa: "TCSI（台湾化学物質）",
    nameEn: "Taiwan Chemical Substance Inventory (TCSI)",
    matchPattern: null,
    displayFormat: "該当",
    numberLabel: "TCSI",
  },
  {
    listId: 620,
    code: "AIIC",
    country: "AUS",
    nameOriginal: "Australian Inventory of Industrial Chemicals",
    nameLang: "EN",
    nameJa: "AIIC（豪州工業化学品）",
    nameEn: "Australian Inventory of Industrial Chemicals (AIIC)",
    matchPattern: null,
    displayFormat: "該当",
    numberLabel: "AIIC",
  },
  {
    listId: 621,
    code: "PICCS",
    country: "PHL",
    nameOriginal: "Philippine Inventory of Chemicals and Chemical Substances",
    nameLang: "EN",
    nameJa: "PICCS（フィリピン化学物質）",
    nameEn: "Philippine Inventory of Chemicals and Chemical Substances (PICCS)",
    matchPattern: null,
    displayFormat: "該当",
    numberLabel: "PICCS",
  },
  {
    listId: 3005,
    code: "NZIOC",
    country: "NZL",
    nameOriginal: "New Zealand Inventory of Chemicals",
    nameLang: "EN",
    nameJa: "NZIoC（NZ化学物質）",
    nameEn: "New Zealand Inventory of Chemicals (NZIoC)",
    /*
      NZ は「載っている＝使ってよい」ではない。
      6割は「個別の承認は無いが、グループ基準の下でなら使える」と書かれている。
      **承認番号（HSR…）を持つものだけを出す。**
      一律「該当」と出すと、承認があるように読まれてしまう。
    */
    matchPattern: "(HSR\\d+)",
    displayFormat: "$1",
    numberLabel: "HSNO 承認番号",
  },
];

/** 足りない国。インベントリの持ち主として要る */
const COUNTRIES: { code: string; region: string; nameJa: string; nameEn: string }[] = [
  { code: "EU", region: "EUM", nameJa: "欧州連合", nameEn: "European Union" },
  { code: "TWN", region: "APAC", nameJa: "台湾", nameEn: "Taiwan" },
  { code: "PHL", region: "APAC", nameJa: "フィリピン", nameEn: "Philippines" },
];

/** まとめて入れる単位。大きすぎると1回の問い合わせが重くなる */
const BATCH = 5000;

async function ensureCountries(write: boolean) {
  for (const def of COUNTRIES) {
    const found = await prisma.country.findFirst({
      where: { codeNormalized: normalizeCode(def.code) },
      select: { id: true },
    });
    if (found) continue;
    const region = await prisma.region.findFirst({
      where: { codeNormalized: normalizeCode(def.region) },
      select: { id: true },
    });
    if (!region) throw new Error(`地域 ${def.region} がありません`);
    console.log(`  国を足します: ${def.nameJa}`);
    if (write) {
      await prisma.country.create({
        data: {
          code: def.code,
          codeNormalized: normalizeCode(def.code),
          regionId: region.id,
          nameJa: def.nameJa,
          nameEn: def.nameEn,
          displayOrder: 900,
        },
      });
    }
  }
}

async function main() {
  const path = process.argv[2];
  const write = process.argv.includes("--write");
  if (!path || path.startsWith("--")) throw new Error("TSVのパスを渡してください");

  /*
    バージョンとデータソースは、CASリンクの取り込みと同じ決めかた。
    現在のバージョンが立っていなければ入れる先が決まらないので、そこで止める
  */
  /* バージョンは引数で選べる。省くと現在のバージョン */
  const versionArg = process.argv.slice(2).find((a) => /^\d{4}Q\d$/i.test(a));
  const version = await prisma.linkSetVersion.findFirst({
    where: versionArg
      ? { codeNormalized: versionArg.toUpperCase(), deletedAt: null }
      : { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version) {
    throw new Error(
      versionArg ? `バージョン ${versionArg} がありません` : "現在のバージョンが決まっていません",
    );
  }
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);
  console.log(`${version.code} × ${source.code} に取り込みます`);

  await ensureCountries(write);

  /** LOLI の一覧番号 → こちらのインベントリの id */
  const idOfList = new Map<number, string>();
  for (const [i, def] of INVENTORIES.entries()) {
    const country = await prisma.country.findFirst({
      where: { codeNormalized: normalizeCode(def.country), deletedAt: null },
      select: { id: true },
    });
    if (!country) {
      console.log(`  ✗ 国 ${def.country} がありません（${def.nameJa}）`);
      continue;
    }
    let inv = await prisma.inventory.findFirst({
      where: { codeNormalized: normalizeCode(def.code) },
      select: { id: true },
    });
    if (!inv && write) {
      inv = await prisma.inventory.create({
        data: {
          code: def.code,
          codeNormalized: normalizeCode(def.code),
          countryId: country.id,
          nameOriginal: def.nameOriginal,
          nameLang: def.nameLang,
          nameJa: def.nameJa,
          nameEn: def.nameEn,
          sourceListId: def.listId,
          displayOrder: i,
          numberLabel: def.numberLabel,
          numberOrder: i,
          // 呼び名を決めてあるものは、そのまま物質の画面に出す
          numberShown: def.numberLabel !== null,
        },
        select: { id: true },
      });
    }
    if (inv) idOfList.set(def.listId, inv.id);
  }

  /*
    入れ替える。足すだけにすると、LOLI から消えた物質が残り続ける。
    **消すのはこのバージョン・このデータソースのぶんだけ。**
    過去のバージョンと、他のところから取ったぶんには手を触れない
  */
  if (write && idOfList.size > 0) {
    const removed = await prisma.inventoryRow.deleteMany({
      where: {
        versionId: version.id,
        sourceId: source.id,
        inventoryId: { in: [...idOfList.values()] },
      },
    });
    if (removed.count > 0) console.log(`  前の行 ${removed.count}件を消しました`);
  }

  /** インベントリごとの取り出しかた。行を読むたびに引く */
  const ruleOf = new Map(
    INVENTORIES.map((d) => [d.listId, { pattern: d.matchPattern, format: d.displayFormat }]),
  );

  const tally = new Map<number, number>();
  /** 取り出せなかった行。数だけ出す（一致0件なら書き方が合っていない合図） */
  const noValue = new Map<number, number>();
  let skipped = 0;
  let buffer: { inventoryId: string; casNumber: string; casNormalized: string; value: string }[] =
    [];

  const flush = async () => {
    if (buffer.length === 0) return;
    // 同じ物質に同じ値が2度書かれている資料がある。一意制約で弾かれるので飛ばす
    if (write) {
      await prisma.inventoryRow.createMany({
        data: buffer.map((b) => ({ ...b, versionId: version.id, sourceId: source.id })),
        skipDuplicates: true,
      });
    }
    buffer = [];
  };

  const stream = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const raw of stream) {
    // 先頭行に BOM が付く
    const line = raw.replace(/^\uFEFF/, "");
    const first = line.indexOf("\t");
    const second = line.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const listId = Number(line.slice(0, first));
    const cas = line.slice(first + 1, second).trim();
    const data = line.slice(second + 1).trim();
    const inventoryId = idOfList.get(listId);
    if (!inventoryId || !cas || !data) {
      skipped += 1;
      continue;
    }
    const rule = ruleOf.get(listId);
    const { values } = rule ? applyExtract(rule, data) : { values: [] };
    if (values.length === 0) {
      noValue.set(listId, (noValue.get(listId) ?? 0) + 1);
      continue;
    }
    const casNormalized = normalizeCas(cas);
    for (const value of values) {
      buffer.push({ inventoryId, casNumber: cas, casNormalized, value });
    }
    tally.set(listId, (tally.get(listId) ?? 0) + values.length);
    if (buffer.length >= BATCH) await flush();
  }
  await flush();

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  for (const def of INVENTORIES) {
    const made = tally.get(def.listId) ?? 0;
    const empty = noValue.get(def.listId) ?? 0;
    const total = made + empty;
    const rate = total === 0 ? 0 : Math.round(((total - empty) / total) * 100);
    console.log(
      `  ${def.nameJa.padEnd(24)} ${String(made).padStart(7)}行` +
        `  取り出せず ${String(empty).padStart(6)}行 (一致 ${String(rate).padStart(3)}%)`,
    );
  }
  console.log(`  読み飛ばし: ${skipped}行`);
  console.log("\n  一致が 0% の名簿があれば、資料の書き方が変わった合図です");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
