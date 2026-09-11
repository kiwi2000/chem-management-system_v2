/**
 * 顧客の写しを当方の正規データと突き合わせ、顧客が何を変えたか・次の配布物とぶつかるかを報告する。
 *
 *   node node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json tools/precheck/compare.ts \
 *     --customer .cache/precheck/customer.json \
 *     --base     .cache/precheck/base.json \
 *     --next     .cache/precheck/next.json        （省いてよい。次に渡す配布物の写し）
 *     --out      .cache/precheck/report.md \
 *     --tsv      .cache/precheck/report.tsv        （省いてよい。全件の一覧）
 *
 * データベースには繋がない。写しは export.ts で取る
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { compare } from "./lib/compare";
import { toMarkdown, toTsv } from "./lib/report";
import { SNAPSHOT_FORMAT, type Snapshot } from "./lib/snapshot";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function need(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`--${name} が要ります`);
    process.exit(1);
  }
  return v;
}

function readSnapshot(path: string): Snapshot {
  const s = JSON.parse(readFileSync(path, "utf-8")) as Snapshot;
  if (s.format !== SNAPSHOT_FORMAT)
    throw new Error(`${path}: 写しの形が違います（${String(s.format)}。期待 ${SNAPSHOT_FORMAT}）`);
  return s;
}

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf-8");
}

const customer = readSnapshot(need("customer"));
const base = readSnapshot(need("base"));
const nextPath = arg("next");
const next = nextPath ? readSnapshot(nextPath) : null;

const report = compare(customer, base, next);
const out = need("out");
write(out, toMarkdown(report));
const tsv = arg("tsv");
if (tsv) write(tsv, toTsv(report));

const c = report.summary.counts;
const line = (k: keyof typeof c) => `${c[k].keep} / ${c[k]["keep-check"]} / ${c[k].discuss}`;
console.log(`報告を書きました: ${out}${tsv ? `（全件 ${tsv}）` : ""}`);
console.log(`  顧客の変更 ${report.summary.total} 件（残す / 残す（確認） / 要相談）`);
console.log(`    表示だけ       ${line("display")}`);
console.log(`    判定が変わる   ${line("judgement")}`);
console.log(`    突き合わせの鍵 ${line("key")}`);
