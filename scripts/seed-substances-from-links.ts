/**
 * CASリンクに出てくるCAS番号を、物質マスタに揃える。
 *
 * リンクさせるCASは物質マスタに載っていなければならない。載っていないと、
 * 画面でCAS番号だけが並んで何なのか分からず、組成から判定するときの相手もいない。
 *
 * 名前は3つの資料を順に見る（`scripts/sql/cas-names.sql` で取り出したもの）。
 *
 *   1. CAJ … 自社のデータベース。社内の呼び方にいちばん近い
 *   2. CHRIP … NITE の化学物質総合情報提供システム
 *   3. LOLI … CasSyns の日本語（LangID=21）
 *
 * どれにも日本語名が無いものは、英語名を日本語名の欄にも入れる
 * （日本語名は必須のため。空にすると一覧で名前が消える）。
 *
 * 既にあるCASには触らない。何度流しても結果は同じ。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-substances-from-links.ts [--dry]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 物質コードの頭。社内で付けるコード（SB- など）とぶつからないようにする */
const CODE_PREFIX = "CAS-";

interface Name {
  ja: string | null;
  en: string | null;
  jaSource: string;
}

/**
 * 名前の表。国ごとに1つずつ。**先に書いたものが勝つ**（後から足したもので上書きしない）。
 * 日本のぶんが先。同じCASなら、国内の資料で付いた名前をそのまま使う。
 */
const NAME_FILES = [
  "scripts/data/cas-names.tsv",
  "scripts/data/cas-names-china.tsv",
  "scripts/data/korea-cas-names.tsv",
];

function loadNames(): Map<string, Name> {
  const map = new Map<string, Name>();
  for (const file of NAME_FILES) {
    const text = readFileSync(join(process.cwd(), file), "utf-8");
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const [cas, ja, en, src] = line.split("\t");
      if (!cas) continue;
      const key = normalizeCas(cas);
      if (map.has(key)) continue;
      map.set(key, {
        ja: ja?.trim() || null,
        en: en?.trim() || null,
        jaSource: src?.trim() ?? "",
      });
    }
  }
  return map;
}

async function main() {
  const dry = process.argv.includes("--dry");
  const names = loadNames();
  console.log(`物質名を ${names.size} 件読み込みました`);

  /*
    **バージョンは絞らない。**物質マスタはバージョンを持たないので、
    現在のバージョンだけを見ると、1つ前にしか出てこないCASが取り残される。
    取り残すと、そのバージョンに切り替えたときにCAS番号だけが並ぶ。
  */
  const linked = await prisma.statutoryCasLink.findMany({
    select: { casNumber: true, casNormalized: true },
    distinct: ["casNormalized"],
  });
  console.log(`リンクに出てくるCAS: ${linked.length} 種（全バージョン）`);

  // 既に物質マスタにあるCAS
  const existing = await prisma.substance.findMany({
    where: { deletedAt: null, casNormalized: { not: null } },
    select: { casNormalized: true },
  });
  const have = new Set(existing.map((e) => e.casNormalized!));
  console.log(`物質マスタに既にあるCAS: ${have.size} 種`);

  const missing = linked.filter((l) => !have.has(l.casNormalized!));
  console.log(`足りないCAS: ${missing.length} 種`);

  let noName = 0;
  let jaFromEn = 0;
  const rows = missing.map((l) => {
    const cas = l.casNormalized!;
    const n = names.get(cas);
    if (!n) noName += 1;
    const en = n?.en ?? null;
    let ja = n?.ja ?? null;
    if (!ja) {
      // 日本語名は必須。無ければ英語名を入れる（空にすると一覧で名前が消える）
      ja = en ?? l.casNumber;
      jaFromEn += 1;
    }
    const code = `${CODE_PREFIX}${l.casNumber}`.slice(0, 20);
    return {
      code,
      codeNormalized: normalizeCode(code),
      casNumber: l.casNumber,
      casNormalized: cas,
      // 同じCASの物質はまだ無いので、これが代表になる
      isCasRepresentative: true,
      nameJa: ja.slice(0, 500),
      nameEn: en?.slice(0, 500) ?? null,
      publishState: "PUBLISHED" as const,
      note: `外部データベースの取り込みで作成（名前の出どころ: ${n?.jaSource || "英語名のみ"}）`,
    };
  });

  // コードが重なっていないか（社内で同じコードを使っていないか）を先に見る
  const codes = rows.map((r) => r.codeNormalized);
  const clash = await prisma.substance.findMany({
    where: { codeNormalized: { in: codes } },
    select: { code: true },
  });
  if (clash.length > 0) {
    throw new Error(`コードが既に使われています: ${clash.map((c) => c.code).join(", ")}`);
  }

  console.log(
    `作るもの ${rows.length} 件（名前が引けなかった ${noName} 件、` +
      `日本語名が無く英語名で埋めた ${jaFromEn} 件）`,
  );
  if (dry) {
    console.log("--dry なので書き込みません。作るものの例:");
    for (const r of rows.slice(0, 5)) console.log(`  ${r.code} | ${r.nameJa} | ${r.nameEn}`);
    return;
  }

  // 1回に全部入れると重いので、区切って入れる
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await prisma.substance.createMany({ data: rows.slice(i, i + CHUNK) });
    console.log(`  ${Math.min(i + CHUNK, rows.length)} / ${rows.length}`);
  }
  console.log(`物質マスタに ${rows.length} 件を足しました`);
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
