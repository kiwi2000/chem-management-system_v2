/**
 * 米国の投入用データ（`scripts/data/us.json`）を、CFR の原文から作る。
 *
 *   bash scripts/us-fetch.sh                    先に原文を落とす
 *   npx tsx scripts/build-us-data.ts            いま置いてあるものと見比べる
 *   npx tsx scripts/build-us-data.ts --write    作り直して書き込む
 *
 * **CFR は法文物質名と CAS を同じ表に載せている。**
 * 日本や中国と違い、CASリンクまで原文から作れる（第8章 8-9）。
 *
 * **法律が示す CAS は法文物質名の側に持つ。**
 * 番号の欄が空ならそこに CAS を書き、埋まっていれば名前を「CAS 名称」にする。
 * 判定に使う CAS リンクは LOLI から取るので、ここでは作らない（第8章 8-7）。
 *
 * 取れないもの
 *   40 CFR 372.65(c) の chemical categories は、eCFR では**画像**でしか無い。
 *   Federal Register の PNG が貼ってあるだけで、テキストが取り出せない。
 *   **推測で書かない。**別の出どころが要る（第8章 8-9）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "us");
const OUT = join(process.cwd(), "scripts", "data", "us.json");

export interface UsItem {
  law: string;
  section: string;
  /** CFR が振っている番号。無ければ CAS を番号がわりにする */
  number: string;
  name: string;
  /** 原文が載せている CAS。**リンクはここから作る** */
  cas: string;
  note: string;
}

function read(name: string): string {
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    throw new Error(`${name} がありません。先に bash scripts/us-fetch.sh を流してください`);
  }
  return readFileSync(path, "utf8");
}

/** HTML の表を「行 × セル」にする */
function tableCells(html: string): string[][] {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!);
  const out: string[][] = [];
  for (const r of rows) {
    const cells = [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((x) =>
      x[1]!
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (cells.length > 0) out.push(cells);
  }
  return out;
}

const CAS = /^\d{2,7}-\d{2}-\d$/;

/**
 * EPCRA 第313条（SARA 313 / TRI）。40 CFR 372.65。
 *
 * 同じ中身が2回載っている。**(a) は名前順、(b) は CAS 順で、中身は同じ。**
 * (d)/(e) も同じ関係（PFAS）。**(a) と (d) だけを採る。**
 * 列は「Chemical name / CAS No. / Effective date」
 */
function buildTri(): UsItem[] {
  const html = read("tri.html");
  const out: UsItem[] = [];
  const seen = new Set<string>();

  for (const c of tableCells(html)) {
    if (c.length < 3) continue;
    // 名前順の表だけを採る。1列目が CAS の表は CAS 順の写しなので飛ばす
    const [name, cas] = [c[0] ?? "", c[1] ?? ""];
    if (!CAS.test(cas) || CAS.test(name)) continue;
    if (seen.has(cas)) continue;
    seen.add(cas);
    out.push({
      law: "US-EPCRA",
      section: "TRI",
      number: cas,
      name,
      cas,
      note: `40 CFR 372.65 / 収載日 ${c[2] ?? ""}`,
    });
  }
  return out;
}

/**
 * TSCA 第6条。40 CFR 751。
 *
 * 部の下が物質ごとの subpart に分かれていて、**表ではなく条文の中に CAS がある。**
 * subpart の見出しと、その範囲に出てくる CAS を結ぶ
 */
function buildTsca6(): UsItem[] {
  const html = read("tsca6.html");
  const heads = [...html.matchAll(/>Subpart ([B-Z])—([^<]+)</g)];
  const out: UsItem[] = [];

  for (const [i, h] of heads.entries()) {
    const start = h.index;
    const end = i + 1 < heads.length ? heads[i + 1]!.index : html.length;
    const body = html.slice(start, end);
    const title = h[2]!.replace(/&amp;/g, "&").trim();
    if (/Reserved/i.test(title)) continue;

    const cases = [...new Set(body.match(/\b\d{2,7}-\d{2}-\d\b/g) ?? [])];
    if (cases.length === 0) continue;
    for (const cas of cases) {
      out.push({
        law: "US-TSCA",
        section: "SEC6",
        number: `${h[1]}-${cas}`,
        // 番号の欄が埋まっているので、名前の側に CAS を書く
        name: `${cas} ${title}`,
        cas,
        note: `40 CFR 751 Subpart ${h[1]}（${title}）`,
      });
    }
  }
  return out;
}

function main() {
  const write = process.argv.includes("--write");
  const all = [...buildTri(), ...buildTsca6()];

  const tally = new Map<string, number>();
  for (const i of all)
    tally.set(`${i.law} ${i.section}`, (tally.get(`${i.law} ${i.section}`) ?? 0) + 1);
  for (const [k, v] of tally) console.log(`  ${k.padEnd(20)} ${String(v).padStart(5)}件`);
  console.log(`\n合計 ${all.length}件`);
  console.log("※ 40 CFR 372.65(c) の chemical categories は eCFR では画像。取れていない");

  if (write) {
    writeFileSync(OUT, `${JSON.stringify(all, null, 1)}\n`, "utf8");
    console.log(`→ ${OUT}`);
  } else if (existsSync(OUT)) {
    const now = readFileSync(OUT, "utf8");
    console.log(
      now === `${JSON.stringify(all, null, 1)}\n`
        ? "いま置いてあるものと同じです。"
        : "食い違います。--write で作り直します。",
    );
  } else {
    console.log("まだ書き出していません。--write で作ります。");
  }
}

main();
