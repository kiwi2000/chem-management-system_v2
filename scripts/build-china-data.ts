/**
 * 中国の目録の**原文から**投入用データ（`scripts/data/china.json`）を作る。
 *
 *   bash scripts/china-fetch.sh                      先に原文を落とす
 *   npx tsx scripts/build-china-data.ts              いま置いてあるものと見比べる
 *   npx tsx scripts/build-china-data.ts --write      作り直して書き込む
 *
 * **日本と同じ形にするためのもの。**
 * 法文物質名は公布された目録から作り、CAS は LOLI から結ぶ（第0章の原則）。
 * それまでは法文物質名まで LOLI から作っていた。
 *
 * 中国語はすべて BMP の中に収まる（第2章 2-4）。
 * **NFKC をかけてはいけない。**`[含量＞20%]` の `＞` が半角になり、原文と変わる。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { column, readPdfRows } from "./lib/pdf-rows";

const CACHE = join(process.cwd(), ".cache", "china");
const OUT = join(process.cwd(), "scripts", "data", "china.json");

/** 目録の1品目 */
export interface ChinaItem {
  /** 区分コード。`regulation_categories.code` と同じ */
  section: string;
  /** 目録が振っている番号。**LOLI との突合の鍵**（第4章） */
  number: string;
  /** 中国語の品名。原文のまま */
  name: string;
  /** 別名。無ければ空 */
  alias: string;
  /** 原文が載せている CAS。総称では空だったり複数だったりする */
  cas: string;
  /** 備考（分類・管控措置など） */
  note: string;
}

/** HTML の表を「行 × セル」にする。LibreOffice が出す HTML も官庁の HTML も同じ形 */
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
        .replace(/\s+/g, "")
        .trim(),
    );
    if (cells.length > 0) out.push(cells);
  }
  return out;
}

function read(name: string): string {
  const path = join(CACHE, name);
  if (!existsSync(path)) {
    throw new Error(`${name} がありません。先に bash scripts/china-fetch.sh を流してください`);
  }
  return readFileSync(path, "utf8");
}

/**
 * 危険化学品目録（2015バージョン）と劇毒化学品目録。
 *
 * **1つの表から2つの目録が取れる。**備考が `剧毒` の行が劇毒化学品目録。
 * 序号は 1〜2828 の通し番号で、**LOLI はこれを4桁ゼロ埋めで持っている**（`[0835]`）。
 */
function buildHazchem(): ChinaItem[] {
  const cells = tableCells(read("hazchem.html"));
  const raw = cells
    .filter((c) => c.length >= 4 && /^\d+$/.test(c[0] ?? ""))
    .map((c) => ({
      number: c[0]!,
      name: c[1] ?? "",
      alias: c[2] ?? "",
      cas: c[3] ?? "",
      note: c[4] ?? "",
    }));

  for (const f of fixHazNumbers(raw)) {
    console.log(`  ※ 原文の序号を直しました: ${f.was} → ${f.now}  ${f.name}`);
  }

  const out: ChinaItem[] = [];
  for (const item of raw) {
    out.push({ section: "HAZ", ...item });
    if (item.note.includes("剧毒")) out.push({ section: "HYPERTOX", ...item });
  }
  return out;
}

/**
 * 危険化学品目録の**序号の誤植を直す**。
 *
 * 原文には「番号が1つ飛んで、次の番号が2回出る」箇所が3つある。
 * 並び順は正しいので、抜けている番号がそのまま入る。
 *
 * ```
 * 716 二正丙胺
 * 718 二正丙基过氧重碳酸酯   ← 717 の誤り（LOLI も 0717 で持っている）
 * 718 二正丁胺              ← こちらが本当の 718
 * 719 N,N-二正丁基氨基乙醇
 * ```
 *
 * 直すのは**「直前の番号+1 が目録のどこにも無く、かつ印字された番号が他の行と重なる」**
 * ものだけ。条件を満たさないずれは触らない（本当に欠番のことがあるため）。
 *
 * 3か所とも LOLI と突き合わせて確かめてある（717・1951 は LOLI も直している）。
 * 中身は `docs/LOLIデータの気づき.md`。
 */
function fixHazNumbers(rows: { number: string; name: string }[]): {
  was: string;
  now: string;
  name: string;
}[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.number, (count.get(r.number) ?? 0) + 1);
  const missing = new Set<number>();
  const max = Math.max(...rows.map((r) => Number(r.number)));
  for (let n = 1; n <= max; n += 1) if (!count.has(String(n))) missing.add(n);

  const fixed: { was: string; now: string; name: string }[] = [];
  let prev = 0;
  for (const r of rows) {
    const n = Number(r.number);
    const want = prev + 1;
    if (n !== want && missing.has(want) && (count.get(r.number) ?? 0) > 1) {
      fixed.push({ was: r.number, now: String(want), name: r.name });
      r.number = String(want);
      missing.delete(want);
      prev = want;
      continue;
    }
    prev = n;
  }
  return fixed;
}

/**
 * 易製爆危険化学品名録（2017年バージョン）。
 *
 * 序号が `1.1` `9.7` の階層になっている（`1` は「酸类」などの分類の見出し行）。
 * 同じ品名で濃度違いの行が続くことがあり、そこは序号のセルが無い
 */
function buildExplosive(): ChinaItem[] {
  const cells = tableCells(read("explosive.html"));
  const out: ChinaItem[] = [];
  let last = "";
  for (const c of cells) {
    if (c.length < 4) continue;
    const head = c[0] ?? "";
    if (/^\d+\.\d+$/.test(head)) {
      last = head;
      out.push({
        section: "EXPLOSIVE",
        number: head,
        name: c[1] ?? "",
        alias: c[2] ?? "",
        cas: c[3] ?? "",
        note: c[4] ?? "",
      });
      continue;
    }
    // 序号のセルが無い続きの行。**直前の序号にぶら下げる**（濃度違いの区分）
    if (last !== "" && !/^\d/.test(head) && head !== "" && head !== "序号") {
      out.push({
        section: "EXPLOSIVE",
        number: last,
        name: head,
        alias: c[1] ?? "",
        cas: "",
        note: c[2] ?? "",
      });
    }
  }
  return out;
}

/**
 * 重点管控新汚染物清单（2023年バージョン）。
 *
 * 番号は漢数字（`一`〜`十四`）。**CASは「例如：」で例示されるだけで、網羅ではない。**
 * だから CAS は LOLI から取る。
 *
 * **十四「已淘汰类」の下に10物質がぶら下がる。**
 * その行は番号のセルを持たず、品名とCASの2列しか無い。
 * 番号を `十四-1` … として、1物質ずつ法文物質名にする
 */
function buildNewpol(): ChinaItem[] {
  const cells = tableCells(read("newpol.html"));
  const out: ChinaItem[] = [];
  const KAN = "一二三四五六七八九十";
  let group = "";
  let groupName = "";
  let sub = 0;
  for (const c of cells) {
    const head = (c[0] ?? "").replace(/\s/g, "");
    const isNumber = head !== "" && [...head].every((ch) => KAN.includes(ch));

    if (isNumber && c.length >= 3) {
      group = head;
      groupName = c[1] ?? "";
      sub = 0;
      // 5列のときは、4列目から先が下にぶら下がる物質の1件目
      if (c.length >= 5) {
        sub += 1;
        out.push({
          section: "NEWPOL",
          number: `${group}-${sub}`,
          name: c[2] ?? "",
          alias: "",
          cas: (c[3] ?? "").replace(/^例如[:：]/, ""),
          note: groupName,
        });
        continue;
      }
      out.push({
        section: "NEWPOL",
        number: group,
        name: groupName,
        alias: "",
        cas: (c[2] ?? "").replace(/^例如[:：]/, ""),
        note: c[3] ?? "",
      });
      continue;
    }

    // 番号のセルが無い2列の行は、直前の番号にぶら下がる物質
    if (!isNumber && c.length === 2 && group !== "" && head !== "" && head !== "编号") {
      sub += 1;
      out.push({
        section: "NEWPOL",
        number: `${group}-${sub}`,
        name: head,
        alias: "",
        cas: c[1] ?? "",
        note: groupName,
      });
    }
  }
  return out;
}
/** 優先管理化学品名録（第一批）。編号は `PC001` の形で、LOLI もこれを持っている */
function buildPriority1(): ChinaItem[] {
  const cells = tableCells(read("priority1.html"));
  const out: ChinaItem[] = [];
  for (const c of cells) {
    if (c.length < 2) continue;
    const head = (c[0] ?? "").replace(/\s/g, "");
    if (!/^PC\d+$/i.test(head)) continue;
    out.push({
      section: "PRIORITY1",
      number: head.toUpperCase(),
      name: c[1] ?? "",
      alias: "",
      cas: c[2] ?? "",
      note: "",
    });
  }
  return out;
}

/**
 * 優先控制化学品名録（第二批）。PDF。
 *
 * **`pdftotext -layout` では読めない。**CAS の欄が1行ずれて出る
 * （`docs/法規制データの作り方.md` 第8章 8-6a）。座標で読む。
 *
 * ```
 * x=142 … 序号ごとの項目          多环芳烃类物质，包括：
 * x=163 … その下にぶら下がる物質    苯并[a]蒽 / 苯并[a]菲 / …
 * ```
 *
 * 序号（`PC028`）は結合セルの**まん中**に来るので、行の並びだけでは決まらない。
 * **左端の位置で項目の切れ目を見て**、その group の中に出てくる序号を採る。
 */
async function buildPriority2(): Promise<ChinaItem[]> {
  const rows = await readPdfRows(join(CACHE, "priority2.pdf"));
  interface Group {
    number: string;
    name: string;
    children: string[];
    cas: string[];
  }
  const groups: Group[] = [];
  let cur: Group | null = null;
  /**
   * 品名の無い、CAS だけの行のかたまり。
   *
   * **結合セルが品名の行をまたぐ**ので、上にも下にも伸びる（PC038 は上に2行・下に2行）。
   * かたまりの**直前の項目**に付ける。間に切れ目（CAS も品名も無い行）があれば、
   * 直後の項目に付ける
   */
  let run: string[] = [];
  /** かたまりの寄せ先の候補。**切れ目の行が来たら消える**（地続きでなくなるため） */
  let attachable: Group | null = null;
  let runAfterGroup: Group | null = null;

  const flushTo = (g: Group | null) => {
    if (g && run.length > 0) g.cas.push(...run);
    run = [];
    runAfterGroup = null;
  };

  for (const r of rows) {
    const no = column(r, 60, 130);
    const cas = column(r, 320, 520).match(/\d{2,7}-\d{2}-\d/g) ?? [];
    const nameWords = r.words.filter((w) => w.x >= 130 && w.x < 320);
    const name = nameWords
      .map((w) => w.text)
      .join("")
      .trim();
    const left = nameWords[0]?.x ?? 0;

    // 見出しと注記の行は捨てる
    if (name === "化学品名称" || /^\*注/.test(no)) continue;

    if (name === "" && cas.length > 0) {
      // CAS だけの行。まだ寄せ先を決めない
      if (run.length === 0) runAfterGroup = attachable;
      run.push(...cas);
      continue;
    }
    if (name === "") {
      // 切れ目。**ここで地続きが切れる**ので、この先のかたまりは直後の項目のもの
      if (/^PC\d+$/i.test(no) && cur) cur.number = no.toUpperCase();
      flushTo(runAfterGroup);
      attachable = null;
      continue;
    }

    if (left <= 150) {
      // 新しい項目。**かたまりが直前の項目と地続きなら直前へ、そうでなければこちらへ**
      const target = runAfterGroup ?? null;
      cur = { number: "", name, children: [], cas: [] };
      groups.push(cur);
      flushTo(target ?? cur);
      attachable = cur;
    } else if (cur) {
      cur.children.push(name);
      flushTo(runAfterGroup);
      attachable = cur;
    }
    if (/^PC\d+$/i.test(no) && cur) cur.number = no.toUpperCase();
    if (cur) cur.cas.push(...cas);
  }
  flushTo(runAfterGroup);

  const out = groups
    .filter((g) => g.number !== "")
    .map((g) => ({
      section: "PRIORITY2",
      number: g.number,
      // 「◯◯類物質，包括：」は下にぶら下がる物質までが1項目
      name: g.children.length > 0 ? `${g.name}${g.children.join("、")}` : g.name,
      alias: "",
      cas: [...new Set(g.cas)].join("; "),
      note: "",
    }));

  // **序号が PC023 から連番で並ぶことを確かめる。**欄の切り分けを間違えると崩れる
  const want = out.map((_, i) => `PC${String(23 + i).padStart(3, "0")}`);
  const got = out.map((o) => o.number).join(",");
  if (got !== want.join(",")) {
    throw new Error(`優先控制（第二批）の序号が連番になりません: ${got}`);
  }
  return out;
}

/**
 * 中国厳格制限有毒化学品名録（2023年）。**9件だけ手で書く。**
 *
 * PDF のセル結合が激しく、1つの序号に品名が何行も分かれて入る
 * （`全氟辛基` `磺酸及其` `盐类和全` …）。機械で読むと語が割れる。
 * 9件しかないので、**PDF を読んで書き写し、原文と1件ずつ突き合わせた**。
 *
 * 見直すときは `.cache/china/restricted-raw.txt`（`pdftotext -raw`）と見比べる。
 */
const RESTRICTED: { number: string; name: string; cas: string }[] = [
  { number: "1", name: "全氟辛基磺酸及其盐类和全氟辛基磺酰氟（PFOS类）", cas: "1763-23-1" },
  {
    number: "2",
    name: "汞（包括汞含量按重量计至少占95%的汞与其他物质的混合物，其中包括汞的合金）",
    cas: "7439-97-6",
  },
  { number: "3", name: "四甲基铅", cas: "75-74-1" },
  { number: "4", name: "四乙基铅", cas: "78-00-2" },
  { number: "5", name: "多氯三联苯（PCT）", cas: "61788-33-8" },
  { number: "6", name: "三丁基锡化合物", cas: "56-35-9" },
  { number: "7", name: "短链氯化石蜡", cas: "85535-84-8" },
  { number: "8", name: "十溴二苯醚", cas: "1163-19-5" },
  { number: "9", name: "全氟辛酸及其盐类和相关化合物（PFOA类）", cas: "" },
];

function buildRestricted(): ChinaItem[] {
  // 原文が手元にあることだけ確かめる（無ければ書き写しの見直しができない）
  read("restricted.txt");
  return RESTRICTED.map((r) => ({
    section: "RESTRICTED",
    number: r.number,
    name: r.name,
    alias: "",
    cas: r.cas,
    note: "",
  }));
}
const BUILDERS: { label: string; run: () => ChinaItem[] | Promise<ChinaItem[]> }[] = [
  { label: "危険化学品目録／劇毒化学品目録", run: buildHazchem },
  { label: "易製爆危険化学品名録", run: buildExplosive },
  { label: "重点管控新汚染物清单", run: buildNewpol },
  { label: "優先管理化学品名録（第一批）", run: buildPriority1 },
  { label: "優先管理化学品名録（第二批）", run: buildPriority2 },
  { label: "中国厳格制限有毒化学品名録", run: buildRestricted },
];

async function main() {
  const write = process.argv.includes("--write");
  const all: ChinaItem[] = [];
  for (const b of BUILDERS) {
    let items: ChinaItem[] = [];
    try {
      items = await b.run();
    } catch (e) {
      console.log(`✗ ${b.label}: ${(e as Error).message}`);
      continue;
    }
    const bySection = new Map<string, number>();
    for (const i of items) bySection.set(i.section, (bySection.get(i.section) ?? 0) + 1);
    console.log(
      `✓ ${b.label.padEnd(22)} ${[...bySection].map(([k, v]) => `${k}=${v}件`).join(" ")}`,
    );
    all.push(...items);
  }

  // **BMP の外の文字が混じっていないか見る。**混じっていれば取り出しがどこかで壊れている
  const bad = all.filter((i) => [...i.name].some((ch) => ch.codePointAt(0)! > 0xffff));
  if (bad.length > 0) console.log(`  ※ BMP の外の文字が ${bad.length}件`);

  console.log(`\n合計 ${all.length}件`);
  if (write) {
    writeFileSync(OUT, `${JSON.stringify(all, null, 1)}\n`, "utf8");
    console.log(`→ ${OUT}`);
  } else if (existsSync(OUT)) {
    const now = JSON.parse(readFileSync(OUT, "utf8")) as ChinaItem[];
    const same = JSON.stringify(now) === JSON.stringify(all);
    console.log(
      same
        ? "いま置いてあるものと同じです。"
        : `いま置いてあるものは ${now.length}件。--write で作り直します。`,
    );
  } else {
    console.log("まだ書き出していません。--write で作ります。");
  }
}

main();
