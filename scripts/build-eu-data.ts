/**
 * EU の投入用データ（`scripts/data/eu.json`）を、ECHA から落とした一覧で作る。
 *
 *   npx tsx scripts/build-eu-data.ts          いま置いてあるものと見比べる
 *   npx tsx scripts/build-eu-data.ts --write  作り直して書き込む
 *
 * 元は `.cache/eu/*.tsv`。**取り方はブラウザ**で、手順は第2章 2-6。
 * `curl` は 403 を返すので落とせない。
 *
 * **総称の中身も一緒に取れる。**ECHA の表は「まとめ名」の下に
 * 構成物質を `show/hide` で畳んでおり、テキストにすると1つのセルに入る。
 *
 * ```
 * Hexabromocyclododecane (HBCDD) and all major diastereoisomers identified show/hide
 *   Hexabromocyclododecane EC No.: 247-148-4 | CAS No.: 25637-99-4
 *   alpha-hexabromocyclododecane EC No.: - | CAS No.: 134237-50-6 …
 * ```
 *
 * ここを割ると、**総称にぶら下がる CAS まで分かる**（第8章 8-8）。
 *
 * **法律が示す CAS は法文物質名の側に持つ。**
 * 番号の欄が空ならそこに CAS を書き、埋まっていれば名前を「CAS 名称」にする。
 * 名前に入れるのは**表の「CAS No.」欄の代表1つだけ**。
 * 構成物質のぶんまで入れると名前が壊れる。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE = join(process.cwd(), ".cache", "eu");
const OUT = join(process.cwd(), "scripts", "data", "eu.json");

export interface EuItem {
  law: string;
  section: string;
  /** 附属書の entry 番号。候補リストには番号が無いので EC番号かCASを使う */
  number: string;
  name: string;
  /** EC番号（`203-777-6`）。無ければ空 */
  ec: string;
  /** この項目に結び付く CAS。**総称では構成物質のぶんだけ入る** */
  cas: string[];
  note: string;
}

/** ファイルをそのまま読む。CSV は行に割る前の形が要る */
function readFile(name: string): string {
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    throw new Error(`${name} がありません。第2章 2-6 の手順で用意してください`);
  }
  return readFileSync(path, "utf8");
}

function read(name: string): string[] {
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    throw new Error(`${name} がありません。第2章 2-6 の手順でブラウザから落としてください`);
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");
}

const CAS_RE = /\b\d{2,7}-\d{2}-\d\b/g;

/**
 * 名前の欄から、まとめ名と構成物質を分ける。
 *
 * `show/hide` から後ろが構成物質の並び。**そこに CAS が入っている。**
 * まとめ名だけを名前にし、CAS は構成物質のぶんも拾う
 */
function splitName(raw: string): { name: string; inner: string } {
  const at = raw.indexOf("show/hide");
  if (at < 0) return { name: raw.trim(), inner: "" };
  return { name: raw.slice(0, at).trim(), inner: raw.slice(at + "show/hide".length) };
}

/**
 * 番号の欄が埋まっているときに、名前の頭へ CAS を付ける。
 *
 * **代表の CAS 1つだけ。**総称は構成物質を何十件も持つので、全部入れると名前が壊れる。
 * 既に頭に付いていれば足さない（何度流しても同じ形になるように）
 */
function withCas(name: string, casColumn: string): string {
  const first = (casColumn.match(/\d{2,7}-\d{2}-\d/) ?? [])[0];
  if (!first) return name;
  return name.startsWith(first) ? name : `${first} ${name}`;
}

/** `-` は「無い」の意味。空にそろえる */
const orEmpty = (s: string) => (s === "-" || s === "" ? "" : s);

/** 候補リスト（SVHC）。列は 名前 / EC / CAS / 収載日 / 理由 */
function buildSvhc(): EuItem[] {
  const out: EuItem[] = [];
  for (const line of read("svhc.tsv")) {
    const c = line.split("\t");
    if (c.length < 4) continue;
    const { name, inner } = splitName(c[0] ?? "");
    if (name === "" || /^\d+$/.test(name)) continue;
    const cas = [
      ...new Set([...(c[2] ?? "").matchAll(CAS_RE), ...inner.matchAll(CAS_RE)].map((m) => m[0])),
    ];
    out.push({
      law: "EU-REACH",
      section: "SVHC",
      number: orEmpty(c[1] ?? "") || cas[0] || name.slice(0, 40),
      // 番号が EC番号のときは、名前の側に CAS を書く
      name: orEmpty(c[1] ?? "") === "" ? name : withCas(name, c[2] ?? ""),
      ec: orEmpty(c[1] ?? ""),
      cas,
      note: `候補リスト 収載 ${c[3] ?? ""} / ${c[4] ?? ""}`.trim(),
    });
  }
  return out;
}

/** 附属書XIV（認可対象）。列は entry / 名前 / EC / CAS / 申請期限 / 日没日 / 性質 */
function buildAnnex14(): EuItem[] {
  const out: EuItem[] = [];
  for (const line of read("annex14.tsv")) {
    const c = line.split("\t");
    if (c.length < 4) continue;
    const { name, inner } = splitName(c[1] ?? "");
    const cas = [
      ...new Set([...(c[3] ?? "").matchAll(CAS_RE), ...inner.matchAll(CAS_RE)].map((m) => m[0])),
    ];
    out.push({
      law: "EU-REACH",
      section: "ANNEX14",
      number: c[0] ?? "",
      name: withCas(name, c[3] ?? ""),
      ec: orEmpty(c[2] ?? ""),
      cas,
      note: `申請期限 ${c[4] ?? ""} / 日没日 ${c[5] ?? ""} / ${c[6] ?? ""}`.trim(),
    });
  }
  return out;
}

/** 附属書XVII（制限）。列は entry / 名前 / EC / CAS / 条件 */
function buildAnnex17(): EuItem[] {
  const out: EuItem[] = [];
  for (const line of read("annex17.tsv")) {
    const c = line.split("\t");
    if (c.length < 4) continue;
    const { name, inner } = splitName(c[1] ?? "");
    const cas = [
      ...new Set([...(c[3] ?? "").matchAll(CAS_RE), ...inner.matchAll(CAS_RE)].map((m) => m[0])),
    ];
    out.push({
      law: "EU-REACH",
      section: "ANNEX17",
      number: c[0] ?? "",
      name: withCas(name, c[3] ?? ""),
      ec: orEmpty(c[2] ?? ""),
      cas,
      // 条件は長い。**先頭だけを残す**（全文は ECHA を見る）
      note: (c[4] ?? "").slice(0, 300),
    });
  }
  return out;
}

/**
 * CLP規則 附属書VI 表3（調和分類）。**Excel で配られている。**
 *
 * ECHA が `annex_vi_clp_table_atpNN_en.xlsx` を置いており、
 * LibreOffice で CSV にしてから読む（第2章 2-6）。
 *
 * 列は `Index No / ATP / CELEX / Chemical Name / EC No / CAS No / …`。
 * **`Index No` が法令の番号**（`001-001-00-9`）で、これを法文物質名の番号にする。
 *
 * `ATP` はその項目を入れた改正の回。**まだ施行されていない回のものも入っている**ので、
 * どの回で入ったかを `note` に残す（採否は使う側が決める）。
 */
function buildClpAnnex6(): EuItem[] {
  const text = readFile("annex6.csv");
  const rows = parseCsv(text);
  // 3行目が見出し。1〜2行目は但し書き
  const body = rows.slice(3).filter((r) => r.length > 5 && (r[0] ?? "").trim() !== "");
  const out: EuItem[] = [];
  for (const r of body) {
    const cas = [...new Set([...(r[5] ?? "").matchAll(CAS_RE)].map((m) => m[0]))];
    out.push({
      law: "EU-CLP",
      section: "ANNEX6",
      number: (r[0] ?? "").trim(),
      name: withCas((r[3] ?? "").replace(/\s+/g, " ").trim(), r[5] ?? ""),
      ec: orEmpty((r[4] ?? "").trim()),
      cas,
      note: [
        `ATP ${(r[1] ?? "").trim()}`,
        (r[2] ?? "").trim() && `CELEX ${(r[2] ?? "").trim()}`,
        (r[6] ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      ]
        .filter(Boolean)
        .join(" / "),
    });
  }
  return out;
}

/** CSV を読む。引用符の中の改行とカンマを守る */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function main() {
  const write = process.argv.includes("--write");
  const all = [...buildSvhc(), ...buildAnnex14(), ...buildAnnex17(), ...buildClpAnnex6()];

  for (const s of ["SVHC", "ANNEX14", "ANNEX17", "ANNEX6"]) {
    const mine = all.filter((i) => i.section === s);
    const withCas = mine.filter((i) => i.cas.length > 0).length;
    const links = mine.reduce((n, i) => n + i.cas.length, 0);
    console.log(
      `  ${s.padEnd(8)} ${String(mine.length).padStart(4)}件  CAS付き ${String(withCas).padStart(4)}件  リンク ${String(links).padStart(5)}件`,
    );
  }
  console.log(`\n合計 ${all.length}件`);

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
