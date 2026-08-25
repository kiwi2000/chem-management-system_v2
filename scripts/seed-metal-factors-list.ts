/**
 * 金属換算係数を、**LOLI の換算係数リスト**から入れる管理用スクリプト。
 *
 * 実行:
 *   npx tsx scripts/seed-metal-factors-list.ts <TSV>          下見
 *   npx tsx scripts/seed-metal-factors-list.ts <TSV> --write  書き込む
 *
 * TSV は LOLI からこう取り出す（Cas と Data の2列、見出し無し）:
 *   sqlcmd ... -h -1 -W -s $'\t' \
 *     -Q "SET NOCOUNT ON; SELECT CAST(Cas AS varchar(20)), CAST(Data AS varchar(400))
 *         FROM ListData WHERE ListID=9533"
 *
 * ListID 9533 は
 *   Japan - PRTR - Class 1 Substances - Metal Conversion Factors (2021 Amendment)
 * ＝ **化管法が定める換算率そのもの**。
 *
 * `scripts/seed-metal-factors.ts`（分子式から計算するほう）との関係:
 *
 *   こちらが正。分子式から計算した値は上書きしてよい。
 *   法令が使う値と、分子式から出した値が食い違うときは、法令の値を使う。
 *   分子式のほうは、このリストに載っていない CAS の**穴埋め**として残す。
 *
 * **人が手で入れた係数は上書きしない。**
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseMetalFactors } from "./lib/loli-metal-list";

const prisma = new PrismaClient();

/** この印が付いた係数は、このスクリプトが作ったもの。次回は作り直してよい */
const MARK = "LOLIの換算係数リスト（化管法）";
/** 分子式から計算したほうの印。こちらのリストがあれば上書きしてよい */
const MARK_FORMULA = "LOLIの分子式から計算";
/**
 * 分子式から出した値と食い違ったときに、備考へ足す印。
 *
 * **どちらが正しいかは機械では決まらない。**手で数件あたったところ、
 * リストが正しいこともあれば（分子式の欄が壊れている場合）、
 * 分子式が正しいこともある（リスト側の計算違い）。
 * 片方を黙って採ると誤るので、**両方の値を残して人が見られるようにする**。
 */
const MARK_DIFF = "【分子式からの計算と食い違い";
/** どれだけ離れたら食い違いとみなすか（重量％のポイント） */
const DIFF_POINT = 0.5;

async function main() {
  const path = process.argv[2];
  const write = process.argv.includes("--write");
  /** 食い違いの一覧を書き出す先（--diff-out <パス>） */
  const outAt = process.argv.indexOf("--diff-out");
  const out = outAt >= 0 ? process.argv[outAt + 1] : undefined;
  if (!path || path.startsWith("--")) throw new Error("LOLI の TSV のパスを渡してください");

  /** 「CAS|元素」→ 係数（％の文字列） */
  const fromList = new Map<string, { cas: string; element: string; ratioPct: string }>();
  /** 同じ組み合わせで値が食い違ったもの。LOLI 側の不整合なので記録に残す */
  const conflicts: string[] = [];
  let rows = 0;
  let rowsWithFactor = 0;

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const cas = line.slice(0, tab).trim();
    const data = line.slice(tab + 1);
    if (!cas || !data) continue;
    rows += 1;

    const hits = parseMetalFactors(data);
    if (hits.length > 0) rowsWithFactor += 1;
    for (const h of hits) {
      const key = `${cas}|${h.element}`;
      // LOLI は割合（0.907）で持つ。こちらは重量％で持つ
      const ratioPct = (h.ratio * 100).toFixed(6);
      const seen = fromList.get(key);
      if (!seen) {
        fromList.set(key, { cas, element: h.element, ratioPct });
      } else if (seen.ratioPct !== ratioPct && conflicts.length < 20) {
        conflicts.push(`${key}: ${seen.ratioPct}% と ${ratioPct}%`);
      }
    }
  }
  console.log(`リストの行 ${rows}件 / うち係数を持つ行 ${rowsWithFactor}件`);
  console.log(`「CAS × 換算先」の組み合わせ: ${fromList.size}件`);
  if (conflicts.length > 0) {
    console.log(`\n  ※ LOLI の中で値が食い違うもの: ${conflicts.length}件（先に出たほうを採用）`);
    for (const c of conflicts.slice(0, 5)) console.log(`    ${c}`);
  }

  const existing = await prisma.metalConversionFactor.findMany({
    where: { deletedAt: null },
    select: { id: true, casNormalized: true, metalElement: true, ratioPct: true, note: true },
  });
  const byKey = new Map(existing.map((f) => [`${f.casNormalized}|${f.metalElement}`, f]));

  const tally = { made: 0, updated: 0, kept: 0, same: 0 };
  /** 分子式から出した値と、法令の値が食い違ったもの。差の大きい順に見たい */
  const diffs: { key: string; formula: number; list: number; gap: number }[] = [];

  for (const [key, f] of fromList) {
    const found = byKey.get(key);
    const note = found?.note ?? "";
    if (found && !note.startsWith(MARK) && !note.startsWith(MARK_FORMULA)) {
      // 人が入れたもの。触らない
      tally.kept += 1;
      continue;
    }
    /** 分子式から出した値。食い違ったら備考に残す */
    let diffNote = "";
    if (note.startsWith(MARK_FORMULA) && found) {
      const before = Number(found.ratioPct);
      const after = Number(f.ratioPct);
      if (Number.isFinite(before)) {
        const gap = Math.abs(before - after);
        if (gap >= DIFF_POINT) {
          diffs.push({ key, formula: before, list: after, gap });
          diffNote = `${MARK_DIFF}: ${before.toFixed(3)}%】`;
        }
      }
    }
    // すでに前回このスクリプトが入れたものと同じなら、書き直さない
    if (found && note.startsWith(MARK) && Number(found.ratioPct) === Number(f.ratioPct)) {
      tally.same += 1;
      continue;
    }

    if (write) {
      const data = {
        casNumber: f.cas,
        casNormalized: f.cas,
        metalElement: f.element,
        ratioPct: f.ratioPct,
        note: `${MARK}${diffNote}`,
      };
      if (found) await prisma.metalConversionFactor.update({ where: { id: found.id }, data });
      else await prisma.metalConversionFactor.create({ data });
    }
    if (found) tally.updated += 1;
    else tally.made += 1;
  }

  console.log(`\n=== ${write ? "書き込みました" : "下見（--write で書き込みます）"} ===`);
  console.log(`  新しく作る              : ${tally.made}件`);
  console.log(`  分子式の値を法令の値で直す: ${tally.updated}件`);
  console.log(`  すでに同じ              : ${tally.same}件`);
  console.log(`  人が入れたので触らない    : ${tally.kept}件`);
  diffs.sort((a, b) => b.gap - a.gap);
  console.log(`\n  分子式から出した値と ${DIFF_POINT}ポイント以上ずれたもの: ${diffs.length}件`);
  console.log("  （リストの値を採り、備考に分子式からの値も残してある。人が見て決める）");
  for (const d of diffs.slice(0, 15)) {
    console.log(
      `    ${d.key}  分子式 ${d.formula.toFixed(3)}% / リスト ${d.list.toFixed(3)}%  （差 ${d.gap.toFixed(3)}）`,
    );
  }
  if (out) {
    const rows = diffs.map((d) => {
      const [cas, el] = d.key.split("|");
      return `${cas}\t${el}\t${d.formula.toFixed(3)}\t${d.list.toFixed(3)}\t${d.gap.toFixed(3)}`;
    });
    const head = "CAS\t換算先\t分子式からの値\tリストの値\t差";
    writeFileSync(out, [head, ...rows].join("\n") + "\n", "utf8");
    console.log(`\n  食い違いの一覧を書き出した: ${out}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
