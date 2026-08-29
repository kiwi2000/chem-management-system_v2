/**
 * 3つの条約の規制区分・法文物質名を入れる。CASリンクは seed-treaty-links.ts。
 *
 *   bash scripts/loli-dump-treaties.sh                          先に取り出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-treaty-laws.ts
 *   ... scripts/seed-treaty-laws.ts --write
 *
 * **法令そのものは seed-international.ts が既に作っている。**ここは触らない。
 * 中身（区分・法文物質名）だけを足す。
 *
 * **法文物質名は親物質ごとに作る。**条約は「短鎖塩素化パラフィン」のような
 * まとまりで挙げており、LOLI がそこから個々の異性体・塩へ広げている。
 * 広げたぶんは法文物質名ではなくCASリンクなので、親を1件として持つ。
 *
 * **番号は親のCAS。**条約は附属書の中で通し番号を振っているが、LOLI は持っていない。
 * 無い番号を作ると条文と食い違うので、まとめの鍵になっている親のCASをそのまま置く
 * （LOLI の内部コードになることもある）。
 *
 * **閾値は置かない（0%超）。**3つとも「含まれていれば対象」で、
 * 含有率の下限を条約本文が持たないため。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface CategoryDef {
  code: string;
  nameJa: string;
  nameEn: string;
  /** その区分に入れる「くくり」（LOLI の value）。省くと全部 */
  values?: string[];
  note: string;
}

interface TreatyDef {
  /** scripts/data/treaty-<tsv>*.tsv を読む */
  tsv: string;
  law: string;
  nameJa: string;
  categories: CategoryDef[];
  /** くくりを備考に書き残すときの書きかた（区分に使わないとき） */
  valueNote?: (values: string[]) => string;
}

const TREATIES: TreatyDef[] = [
  {
    tsv: "pops",
    law: "INT-POPS",
    nameJa: "ストックホルム条約",
    /*
      附属書で扱いが変わる。廃絶・制限・非意図的生成は SDS の書きかたも違うので分ける
    */
    categories: [
      {
        code: "ANNEX_A",
        nameJa: "附属書A（廃絶）",
        nameEn: "Annex A (Elimination)",
        values: ["Annex A"],
        note: "製造・使用・輸出入を廃絶する物質。用途ごとの適用除外があり、当たるかは用途で決まるため判定では見ていない",
      },
      {
        code: "ANNEX_B",
        nameJa: "附属書B（制限）",
        nameEn: "Annex B (Restriction)",
        values: ["Annex B"],
        note: "認められた用途に限って製造・使用できる物質",
      },
      {
        code: "ANNEX_C",
        nameJa: "附属書C（非意図的生成）",
        nameEn: "Annex C (Unintentional production)",
        values: ["Annex C"],
        note: "意図して作るものではなく、燃焼などで生じる物質。排出の削減が求められる",
      },
    ],
  },
  {
    tsv: "pic",
    law: "INT-PIC",
    nameJa: "ロッテルダム条約",
    /*
      LOLI のくくりは「Adopted 1993」のような**載った年**で、扱いの違いではない。
      区分に使うと年ごとに分かれてしまうので、1つにまとめて年は備考へ回す
    */
    categories: [
      {
        code: "ANNEX3",
        nameJa: "附属書III 掲載物質",
        nameEn: "Annex III listed chemicals",
        note: "輸出入に事前の情報に基づく同意（PIC）が要る物質。輸出国は輸出通報を行う",
      },
    ],
    valueNote: (v) => `条約に載った年: ${v.join(" / ")}`,
  },
  {
    tsv: "minamata",
    law: "INT-MINAMATA",
    nameJa: "水俣条約",
    /*
      LOLI のくくりは条約の**条番号**（第3条＝供給・貿易、第4条＝水銀添加製品 など）。
      どの条に載っていても「条約の対象になる水銀化合物」であることは変わらないので、
      区分は1つにして条番号は備考へ回す
    */
    categories: [
      {
        code: "COVERED",
        nameJa: "条約の対象となる水銀等",
        nameEn: "Mercury and mercury compounds covered by the Convention",
        note: "水銀および水銀化合物。水銀添加製品は品目ごとに製造・輸出入の禁止時期が決まっており、当たるかは製品の種類で決まるため判定では見ていない",
      },
    ],
    valueNote: (v) => `条約の条: ${v.join(" / ")}`,
  },
];

/** 鍵と値の並びに読む */
function readPairs(file: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const text = readFileSync(join(process.cwd(), "scripts/data", `${file}.tsv`), "utf-8");
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "") continue;
    const [k, v] = row.split("\t");
    if (!k || !v) continue;
    const got = map.get(k);
    if (got) got.push(v);
    else map.set(k, [v]);
  }
  return map;
}

/** 区分と、その下の名前のない受け皿を作る */
async function upsertCategory(lawId: string, code: string, payload: Record<string, unknown>) {
  const found = await prisma.regulationCategory.findFirst({
    where: { lawId, codeNormalized: normalizeCode(code) },
    select: { id: true },
  });
  const saved = found
    ? await prisma.regulationCategory.update({
        where: { id: found.id },
        data: payload,
        select: { id: true },
      })
    : await prisma.regulationCategory.create({
        data: { ...payload, code, codeNormalized: normalizeCode(code), lawId } as never,
        select: { id: true },
      });
  const cls = await prisma.regulationClass.findFirst({
    where: { categoryId: saved.id, deletedAt: null },
    select: { id: true },
  });
  return (
    cls?.id ??
    (
      await prisma.regulationClass.create({
        data: { code: "DEFAULT", codeNormalized: "DEFAULT", categoryId: saved.id, displayOrder: 0 },
        select: { id: true },
      })
    ).id
  );
}

async function upsertSubstance(classId: string, code: string, payload: Record<string, unknown>) {
  const found = await prisma.statutorySubstance.findFirst({
    where: { classId, codeNormalized: normalizeCode(code) },
    select: { id: true },
  });
  if (found) {
    await prisma.statutorySubstance.update({ where: { id: found.id }, data: payload as never });
    return;
  }
  await prisma.statutorySubstance.create({
    data: { ...payload, code, codeNormalized: normalizeCode(code), classId } as never,
  });
}

/** CASは数の順、LOLI の内部コードは後ろにまとめる */
function orderOf(key: string): string {
  const m = /^(\d+)-(\d+)-(\d+)$/.exec(key);
  if (!m) return `z${key}`;
  return `a${m[1].padStart(9, "0")}-${m[2]}-${m[3]}`;
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  for (const t of TREATIES) {
    const law = await prisma.law.findFirst({
      where: { codeNormalized: normalizeCode(t.law), deletedAt: null },
      select: { id: true },
    });
    if (!law) throw new Error(`法令 ${t.law} がありません（先に seed-international.ts）`);

    const keys = readPairs(`treaty-${t.tsv}`);
    const names = readPairs(`treaty-${t.tsv}-name`);
    const annex = readPairs(`treaty-${t.tsv}-annex`);
    const casAll = [...keys.values()].reduce((a, b) => a + b.length, 0);
    console.log(`\n${t.law} ${t.nameJa}  親物質 ${keys.size} 種 / CAS ${casAll} 件`);

    for (const [ci, cat] of t.categories.entries()) {
      const mine = [...keys.keys()]
        .filter((k) => !cat.values || (annex.get(k) ?? []).some((v) => cat.values.includes(v)))
        .sort((a, b) => orderOf(a).localeCompare(orderOf(b)));

      let classId: string | null = null;
      if (write) {
        classId = await upsertCategory(law.id, cat.code, {
          nameOriginal: cat.nameEn,
          // 条約の正文は英語
          nameLang: "EN",
          nameJa: cat.nameJa,
          nameEn: cat.nameEn,
          displayOrder: (ci + 1) * 10,
          // 区分の閾値は法文物質名を作るときのひな型。判定には使わない
          thresholdLower: "0",
          lowerBound: "EXCLUSIVE",
          thresholdUpper: "100",
          upperBound: "INCLUSIVE",
          thresholdBasis: "PRODUCT",
          note: cat.note,
        });
      }

      let casCount = 0;
      for (const [i, key] of mine.entries()) {
        casCount += (keys.get(key) ?? []).length;
        const nameEn = names.get(key)?.[0] ?? key;
        if (!write || !classId) continue;
        const vals = annex.get(key) ?? [];
        await upsertSubstance(classId, `${t.law}-${cat.code}-${key}`, {
          officialNumber: key,
          nameOriginal: nameEn,
          nameLang: "EN",
          nameJa: null,
          nameEn,
          displayOrder: i + 1,
          aggregation: "NONE",
          metalEtc: null,
          thresholdLower: "0",
          lowerBound: "EXCLUSIVE",
          thresholdUpper: "100",
          upperBound: "INCLUSIVE",
          note: t.valueNote && vals.length > 0 ? t.valueNote(vals) : null,
        });
      }
      console.log(
        `  ${cat.code.padEnd(9)}${cat.nameJa.padEnd(22)}法文物質名 ${String(mine.length).padStart(4)} 件 / CAS ${String(casCount).padStart(5)} 件`,
      );
    }
  }
  console.log(write ? "\n入れました" : "\n下見だけ。書き込むなら --write");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
