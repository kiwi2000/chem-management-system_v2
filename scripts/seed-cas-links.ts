/**
 * CASリンクを取り込む。元は LOLI（社内SQL Server）。
 *
 * 突合の鍵は名前ではなく**番号**。区分によって何の番号かが違う。
 *
 *   C1 / C2 … 政令番号（Cabinet Order Number）
 *   MON     … 官報公示整理番号の通し番号（Official Gazette Number）
 *   PRI     … 優先評価化学物質の通し番号（Substance control number）
 *   SGN     … 通し番号が無いので、官報公示整理番号そのもので突き合わせる
 *
 * 取り出しかたは `scripts/sql/` の同名のSQLを参照。
 * 同じバージョン・同じデータソースへの取り込みは**入れ替え**なので、先に消してから入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/seed-cas-links.ts [バージョンコード] [区分コード...]
 *
 * バージョンコードを省くと 2026Q3。区分コードを省くと全部。データソースは LOLI 固定。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import { type NumberSpec, statutoryNumber } from "./lib/statutory-number";

const prisma = new PrismaClient();

const SOURCE_CODE = "LOLI";

/** 突合の鍵を、こちらのどの欄から取るか */
type MatchBy = "number" | "gazette";

interface Job {
  law: string;
  category: string;
  tsv: string;
  matchBy: MatchBy;
  /**
   * LOLI側の鍵から落とす前置き。条や別表の番号が付いている。
   *   安衛法 表示: `2-0305` → `0305`（則別表第2の305項）
   *   毒劇法 劇物: `2-1-79` → `79`（指定令 第2条の79号）
   * 前置きが合わない行は、その表のものではないので飛ばす。
   */
  strip?: string;
  /**
   * 最初の区切りまでを鍵にするか。
   * LOLI が**号の下に個別物質を並べている**ことがある（化兵法 `01-001`）。
   * この枝はこちらの法文物質名に無いので、号のところで切る
   */
  head?: boolean;
  /**
   * こちらの番号から落とす接頭辞（正規表現）。
   * 米国 TSCA 第6条は同じ物質が規制の枝ごとに `B-` `D-` を付けて並ぶ
   */
  stripPrefixRe?: string;
  /**
   * `18[a]` のような枝付きの鍵を、**まず `18a` として当て、無ければ `18`** とする。
   *
   * REACH 附属書XVII で、LOLI が項 `18a`（水銀）を `18[a]` と書いている。
   * 一律に括弧を落とすと、水銀が項18（水銀化合物）に付いてしまう
   */
  bracketAlt?: boolean;
  /** 0埋めを外すか。LOLI は `0305` のように桁を揃えていることがある */
  unpad?: boolean;
  /**
   * 条件つきのリンクを書いた取り出し。
   *
   * LOLI は総称から個々の異性体へ広げ、**「政令の名称が定める条件に合致すること」**
   * という但し書きを付ける。炭素数や置換位置で絞られた号で出る。
   * ここに載っている組は、リンクの備考に印を残す（第4章 4-3a）
   */
  conditionTsv?: string;
  /**
   * **こちらの番号の作り方（第0-3章）。**
   *
   * 法文物質名の番号は `則別表第2の1552` のように**出典を含む**。
   * LOLI 側の鍵は枝番しか持たないので、こちらと同じ形に組み立ててから当てる。
   *
   * これで、**同じ区分に複数の表が混ざっていても取り違えない**。
   * 安衛法の表示・通知は 則別表第2・令別表第9・令別表第3第1号 の3本立てで、
   * どれも1から番号が振られる
   */
  spec: NumberSpec;
}

const JOBS: Job[] = [
  // 化審法。番号の種類は区分ごとに違う（政令番号・通し番号・官報公示整理番号）
  {
    law: "JP-CSCL",
    category: "C1",
    tsv: "loli-cscl-c1.tsv",
    matchBy: "number",
    spec: { kind: "orderArticle", table: "1" },
  },
  {
    law: "JP-CSCL",
    category: "C2",
    tsv: "loli-cscl-c2.tsv",
    matchBy: "number",
    spec: { kind: "orderArticle", table: "2" },
  },
  // 監視・優先評価は条文に無い（三大臣の公示）ので、番号はそのまま
  {
    law: "JP-CSCL",
    category: "MON",
    tsv: "loli-cscl-mon.tsv",
    matchBy: "number",
    spec: { kind: "plain" },
  },
  {
    law: "JP-CSCL",
    category: "PRI",
    tsv: "loli-cscl-pri.tsv",
    matchBy: "number",
    spec: { kind: "plain" },
  },
  // 特定一般だけ通し番号が無いので、官報公示整理番号で突き合わせる
  {
    law: "JP-CSCL",
    category: "SGN",
    tsv: "loli-cscl-sgn.tsv",
    matchBy: "gazette",
    spec: { kind: "plain" },
  },
  // 化管法。LOLI の Control No. は別の番号なので使わない。政令番号（Ordinance No.）で引く
  {
    law: "JP-PRTR",
    category: "C1",
    tsv: "loli-prtr-c1.tsv",
    conditionTsv: "loli-prtr-c1-cond.tsv",
    matchBy: "number",
    spec: { kind: "orderTable", table: "1" },
  },
  // 特定第一種は第一種の一部なので、番号も別表第一のまま
  {
    law: "JP-PRTR",
    category: "SC1",
    tsv: "loli-prtr-sc1.tsv",
    conditionTsv: "loli-prtr-c1-cond.tsv",
    matchBy: "number",
    spec: { kind: "orderTable", table: "1" },
  },
  {
    law: "JP-PRTR",
    category: "C2",
    tsv: "loli-prtr-c2.tsv",
    conditionTsv: "loli-prtr-c2-cond.tsv",
    matchBy: "number",
    spec: { kind: "orderTable", table: "2" },
  },
  /*
    毒劇法。**鍵が2種類ある。**
      指定令 `[Order Article 1-17]` → `令第1条第17号`
      法別表 `[Law Table 1-1]`      → `法別表第1の1`
    どちらも1から番号が振られるが、番号に出典が入っているのでぶつからない。
    **特定毒物は LOLI にほぼ無い**（指定令3条・法別表3とも1件だけ）ので取り込まない
  */
  {
    law: "JP-PDSCA",
    category: "TOX",
    tsv: "loli-pdsca-tox.tsv",
    matchBy: "number",
    strip: "1-",
    spec: { kind: "orderArticle", table: "1" },
  },
  {
    law: "JP-PDSCA",
    category: "DEL",
    tsv: "loli-pdsca-del.tsv",
    matchBy: "number",
    strip: "2-1-",
    spec: { kind: "orderArticle", table: "2" },
  },
  {
    law: "JP-PDSCA",
    category: "TOX",
    tsv: "loli-pdsca-tox-l.tsv",
    matchBy: "number",
    strip: "1-",
    spec: { kind: "lawTable", table: "1" },
  },
  {
    law: "JP-PDSCA",
    category: "DEL",
    tsv: "loli-pdsca-del-l.tsv",
    matchBy: "number",
    strip: "2-",
    spec: { kind: "lawTable", table: "2" },
  },
  /*
    安衛法の表示・通知は**3つの表から来る**。
      則別表第2      … 9908 / 9906。本体
      令別表第9      … 9907 / 9905。40件
      令別表第3第1号 … 1818。製造許可物質。表示・通知の対象でもある
    3本とも取り込まないと取り残しが出る（以前は則別表第2しか見ていなかった）
  */
  {
    law: "JP-ISHA",
    category: "LABEL",
    tsv: "loli-isha-label.tsv",
    matchBy: "number",
    strip: "2-",
    unpad: true,
    spec: { kind: "ordinanceTable", table: "2" },
  },
  {
    law: "JP-ISHA",
    category: "LABEL",
    tsv: "loli-isha-label-t9.tsv",
    matchBy: "number",
    strip: "9-",
    unpad: true,
    spec: { kind: "orderTable", table: "9" },
  },
  {
    law: "JP-ISHA",
    category: "LABEL",
    tsv: "loli-isha-mfgpermit.tsv",
    matchBy: "number",
    strip: "3-1-",
    unpad: true,
    spec: { kind: "orderTableItem", table: "3", item: "1" },
  },
  {
    law: "JP-ISHA",
    category: "SDS",
    tsv: "loli-isha-sds.tsv",
    matchBy: "number",
    strip: "2-",
    unpad: true,
    spec: { kind: "ordinanceTable", table: "2" },
  },
  {
    law: "JP-ISHA",
    category: "SDS",
    tsv: "loli-isha-sds-t9.tsv",
    matchBy: "number",
    strip: "9-",
    unpad: true,
    spec: { kind: "orderTable", table: "9" },
  },
  {
    law: "JP-ISHA",
    category: "SDS",
    tsv: "loli-isha-mfgpermit.tsv",
    matchBy: "number",
    strip: "3-1-",
    unpad: true,
    spec: { kind: "orderTableItem", table: "3", item: "1" },
  },
  {
    law: "JP-ISHA",
    category: "MFG_PERMIT",
    tsv: "loli-isha-mfgpermit.tsv",
    matchBy: "number",
    strip: "3-1-",
    unpad: true,
    spec: { kind: "orderTableItem", table: "3", item: "1" },
  },
  {
    law: "JP-ISHA",
    category: "MFG_BAN",
    tsv: "loli-isha-mfgban.tsv",
    matchBy: "number",
    strip: "16-1-",
    unpad: true,
    spec: { kind: "orderArticle", table: "16", paragraph: "1" },
  },
  {
    law: "JP-ISHA",
    category: "SPEC1",
    tsv: "loli-isha-spec1.tsv",
    matchBy: "number",
    strip: "1-",
    unpad: true,
    spec: { kind: "orderTableItem", table: "3", item: "1" },
  },
  {
    law: "JP-ISHA",
    category: "SPEC2",
    tsv: "loli-isha-spec2.tsv",
    matchBy: "number",
    strip: "2-",
    unpad: true,
    spec: { kind: "orderTableItem", table: "3", item: "2" },
  },
  {
    law: "JP-ISHA",
    category: "SPEC3",
    tsv: "loli-isha-spec3.tsv",
    matchBy: "number",
    strip: "3-",
    unpad: true,
    spec: { kind: "orderTableItem", table: "3", item: "3" },
  },

  /*
    環境系4法。**大防法・水濁法は番号がある。**
    土対法・化兵法は番号が無いので、ここには入れない（第4章 4-4 の対応表で結ぶ）
  */
  {
    law: "JP-APA",
    category: "HAZARD",
    tsv: "loli-apa-hazard.tsv",
    matchBy: "number",
    unpad: true,
    spec: { kind: "orderArticle", table: "1" },
  },
  {
    law: "JP-WPCA",
    category: "HAZARD",
    tsv: "loli-wpca-hazard.tsv",
    matchBy: "number",
    unpad: true,
    spec: { kind: "orderArticle", table: "2" },
  },
  // 指定物質は `Number  55` と空白が2つ入る。0埋めもあるので unpad で落とす
  {
    law: "JP-WPCA",
    category: "DESIGNATED",
    tsv: "loli-wpca-desig.tsv",
    matchBy: "number",
    unpad: true,
    spec: { kind: "orderArticle", table: "3の3" },
  } /*
    ここから下は、**LOLI の Data には番号が無く、XML の refno にあった**もの。
    以前は「番号を持たない」と見なして対応表で結んでいたが、取り出し方の誤りだった
    （第4章 4-2c）。
  */,
  // 土壌汚染対策法。refno に令第1条の号（`01`〜`26`）
  {
    law: "JP-SCCA",
    category: "SPECIFIED",
    tsv: "loli-scca.tsv",
    matchBy: "number",
    unpad: true,
    spec: { kind: "orderArticle", table: "1" },
  },
  // 安衛法 有機溶剤。refno に令別表第6の2の号（`01`〜`54`）
  {
    law: "JP-ISHA",
    category: "ORG",
    tsv: "loli-isha-org.tsv",
    matchBy: "number",
    unpad: true,
    spec: { kind: "orderTable", table: "6の2" },
  },
  /*
    安衛法 特別管理物質。refno は `1-01` `2-13-2` で、**第1類・第2類の別まで入っている**。
    特別管理物質は第1類・第2類の上乗せなので、番号も元の号に合わせる
  */
  {
    law: "JP-ISHA",
    category: "SPEC_MGMT",
    tsv: "loli-isha-spm.tsv",
    matchBy: "number",
    strip: "1-",
    unpad: true,
    spec: { kind: "orderTableItem", table: "3", item: "1" },
  },
  {
    law: "JP-ISHA",
    category: "SPEC_MGMT",
    tsv: "loli-isha-spm.tsv",
    matchBy: "number",
    strip: "2-",
    unpad: true,
    spec: { kind: "orderTableItem", table: "3", item: "2" },
  },
  /*
    化学兵器禁止法。LOLI は**別表の項×欄ごとに一覧を分けている**。
      特定物質（一の項）    毒性物質 4048 / 原料物質 4043
      第一種指定物質（二の項）毒性物質 4055 / 原料物質 4050
      第二種指定物質（三の項）毒性物質 4057 / 原料物質 4056
    件数もこちらと一致する（29/5・3/11・4/13）。
    refno は `01` のほか `01-001` のように枝が付く（総称の下に個別物質を並べたもの）ので、
    **最初の区切りまでを号として使う**
  */
  {
    law: "JP-CWCA",
    category: "SPECIFIED",
    tsv: "loli-cwca-spec-tox.tsv",
    matchBy: "number",
    head: true,
    unpad: true,
    spec: { kind: "orderTableColumn", paragraph: "1", table: "3" },
  },
  {
    law: "JP-CWCA",
    category: "SPECIFIED",
    tsv: "loli-cwca-spec-prec.tsv",
    matchBy: "number",
    head: true,
    unpad: true,
    spec: { kind: "orderTableColumn", paragraph: "1", table: "4" },
  },
  {
    law: "JP-CWCA",
    category: "DESIG1",
    tsv: "loli-cwca-d1-tox.tsv",
    matchBy: "number",
    head: true,
    unpad: true,
    spec: { kind: "orderTableColumn", paragraph: "2", table: "3" },
  },
  {
    law: "JP-CWCA",
    category: "DESIG1",
    tsv: "loli-cwca-d1-prec.tsv",
    matchBy: "number",
    head: true,
    unpad: true,
    spec: { kind: "orderTableColumn", paragraph: "2", table: "4" },
  },
  {
    law: "JP-CWCA",
    category: "DESIG2",
    tsv: "loli-cwca-d2-tox.tsv",
    matchBy: "number",
    head: true,
    unpad: true,
    spec: { kind: "orderTableColumn", paragraph: "3", table: "3" },
  },
  {
    law: "JP-CWCA",
    category: "DESIG2",
    tsv: "loli-cwca-d2-prec.tsv",
    matchBy: "number",
    head: true,
    unpad: true,
    spec: { kind: "orderTableColumn", paragraph: "3", table: "4" },
  },
  /*
    米国。**法令が CAS で規定している**ので、こちらの番号が CAS（第0-2章）。
    LOLI は総称（`As Cyanide compounds [RR-…]`）から個々の物質へ広げているので、
    総称の親の CAS を鍵にすれば、こちらの CAS と当たる
  */
  {
    law: "US-EPCRA",
    category: "TRI",
    tsv: "loli-us-tri.tsv",
    matchBy: "number",
    spec: { kind: "plain" },
  },
  /*
    TSCA 第6条。こちらの番号は `B-75-09-2` のように**規制の枝ごとに接頭辞が付く**
    （同じ物質が複数の条件で載る）。CAS のところだけで突き合わせる
  */
  {
    law: "US-TSCA",
    category: "SEC6",
    tsv: "loli-us-tsca6.tsv",
    matchBy: "number",
    stripPrefixRe: "^[A-Z]-",
    spec: { kind: "plain" },
  },
  /*
    EU。附属書XIV・XVII は項番号で突き合わせる。
    こちらは `07` と0埋め、LOLI は `7`。0埋めを外してそろえる
  */
  {
    law: "EU-REACH",
    category: "ANNEX14",
    tsv: "loli-eu-annex14.tsv",
    matchBy: "number",
    unpad: true,
    spec: { kind: "plain" },
  },
  {
    law: "EU-REACH",
    category: "ANNEX17",
    tsv: "loli-eu-annex17.tsv",
    matchBy: "number",
    bracketAlt: true,
    unpad: true,
    spec: { kind: "plain" },
  },
  // 認可候補（SVHC）はこちらの番号が EC番号。EC番号を持たないものは CAS
  {
    law: "EU-REACH",
    category: "SVHC",
    tsv: "loli-eu-svhc.tsv",
    matchBy: "number",
    spec: { kind: "plain" },
  },
];

/**
 * LOLI 側の鍵を、こちらの番号の書き方にそろえる。合わなければ空。
 *
 * 前置きを落とし、0埋めを外し、**最後に出典を付け直す**。
 * 官報公示整理番号で突き合わせるものだけは、出典を付けない。
 *
 * **1つの欄に号が2つ入っていることがある**（有機溶剤の `49, 51`、
 * 特別管理物質の `2-23-3, 2-27-2`）。カンマで分けて両方に結ぶ
 */
function toKeys(raw: string, job: Job): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    let k = part.trim();
    if (job.strip) {
      if (!k.startsWith(job.strip)) continue;
      k = k.slice(job.strip.length);
    }
    if (job.head) k = k.split("-")[0];
    // 「0305」「0100-2」のような0埋めを外す。枝番も区切りごとに外す
    if (job.unpad) k = k.replace(/\d+/g, (d) => String(Number(d)));
    if (k === "") continue;
    out.push(job.matchBy === "gazette" ? k : statutoryNumber(job.spec, k));
  }
  return out;
}

/**
 * 条件つきのリンクに残す印。
 *
 * **そのまま該当にすると誤検出になる。**LOLI は総称から異性体へ広げていて、
 * 政令の名称が「炭素数が10のものに限る」のように絞っているものに、
 * 合わない物質まで付く（2-ノナノールが1-ドデカノールの号に付く）。
 */
const CONDITION_NOTE = "LOLI: 政令の名称が定める条件に合うかは要確認";

/**
 * 鍵をこちらの法文物質名に当てる。
 *
 * `18[a]` のような枝付きは、**まず `18a`（枝を続けた形）**を見て、
 * 無ければ `18`（枝を落とした形）を見る。LOLI の書き方が一定でないため
 */
function resolveKey(k: string, byKey: Map<string, string>, job: Job): string | null {
  if (byKey.has(k)) return k;
  if (!job.bracketAlt) return null;
  const m = /^(.+?)\[([^\]]+)\]$/.exec(k);
  if (!m) return null;
  const joined = `${m[1]}${m[2]}`;
  if (byKey.has(joined)) return joined;
  return byKey.has(m[1]!) ? m[1]! : null;
}

/** LOLI の Cas 欄には UN番号や社内番号（RR-…）も混ざる。CASの形をしたものだけ採る */
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;

/** 備考に「官報公示整理番号: 5-7143」と書いてある。そこだけ取り出す */
const GAZETTE = /官報公示整理番号[:：]\s*([0-9]+-[0-9]+)/;

/**
 * 1つの取り出し（TSV）を取り込む。
 *
 * `append` は「前の中身を消さない」。**同じ区分に取り出しが2つあるとき**に使う
 * （毒劇法は指定令と法別表の2本立て。消してしまうと後の1本しか残らない）
 */
async function run(job: Job, versionId: string, sourceId: string, append = false) {
  const substances = await prisma.statutorySubstance.findMany({
    where: {
      deletedAt: null,
      regulationClass: {
        category: {
          codeNormalized: job.category,
          law: { codeNormalized: job.law },
        },
      },
    },
    select: { id: true, code: true, officialNumber: true, note: true },
  });

  // 鍵 → 法文物質名。同じ鍵が2つ以上あることは無い前提で、あれば先勝ちにする
  const byKey = new Map<string, string>();
  for (const s of substances) {
    let key =
      job.matchBy === "number" ? s.officialNumber : (GAZETTE.exec(s.note ?? "")?.[1] ?? null);
    if (key && job.stripPrefixRe) key = key.replace(new RegExp(job.stripPrefixRe), "");
    if (key && job.unpad) key = key.replace(/\d+/g, (d) => String(Number(d)));
    if (key && !byKey.has(key)) byKey.set(key, s.id);
  }

  /** 条件つきの組。`鍵` と `CAS` をタブでつないだ形。備考に印を残す */
  const conditional = new Set<string>();
  if (job.conditionTsv) {
    const text = readFileSync(join(process.cwd(), "scripts/data", job.conditionTsv), "utf-8");
    for (const l of text.split("\n")) {
      const t = l.trim();
      if (t !== "") conditional.add(t);
    }
  }

  const rows = readFileSync(join(process.cwd(), "scripts/data", job.tsv), "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t"));

  let skippedShape = 0;
  const missed = new Set<string>();
  const seen = new Set<string>();
  const data: {
    statutorySubstanceId: string;
    casNumber: string;
    casNormalized: string;
    note: string | null;
  }[] = [];

  for (const [key, cas] of rows) {
    if (!key || !cas) continue;
    if (!CAS_SHAPE.test(cas)) {
      skippedShape += 1;
      continue;
    }
    const mapped = toKeys(key, job);
    if (mapped.length === 0) {
      missed.add(key);
      continue;
    }
    const casNormalized = normalizeCas(cas);
    for (const m of mapped) {
      const resolved = resolveKey(m, byKey, job);
      const id = resolved === null ? undefined : byKey.get(resolved);
      if (!id) {
        missed.add(m);
        continue;
      }
      const dedup = `${id}/${casNormalized}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      data.push({
        statutorySubstanceId: id,
        casNumber: cas,
        casNormalized,
        note: conditional.has(`${key}	${cas}`) ? CONDITION_NOTE : null,
      });
    }
  }

  // このバージョン・このデータソース・この区分ぶんは入れ替え。前の中身は残さない
  // **ただし append のときは消さない。**同じ区分の2本目だから
  const removed = append
    ? { count: 0 }
    : await prisma.statutoryCasLink.deleteMany({
        where: { versionId, sourceId, statutorySubstanceId: { in: substances.map((s) => s.id) } },
      });
  await prisma.statutoryCasLink.createMany({
    data: data.map((d) => ({ ...d, versionId, sourceId })),
    skipDuplicates: true,
  });

  const linked = new Set(data.map((d) => d.statutorySubstanceId)).size;
  const cond = data.filter((d) => d.note !== null).length;
  console.log(
    `${job.law} ${job.category}: ${removed.count} 件を消し ${data.length} 件を入れました` +
      (cond > 0 ? `（うち条件つき ${cond} 件）` : "") +
      `（法文物質名 ${linked}/${substances.length} 件に結び付き、` +
      `CASの形でない ${skippedShape} 件、番号が合わない ${missed.size} 種を飛ばしました）`,
  );
  if (missed.size > 0 && missed.size <= 10) {
    console.log(`  合わなかった番号: ${[...missed].join(", ")}`);
  }
}

async function main() {
  const [versionArg, ...only] = process.argv.slice(2);
  const versionCode = versionArg ?? "2026Q3";

  const version = await prisma.linkSetVersion.findFirst({
    where: { codeNormalized: versionCode.toUpperCase(), deletedAt: null },
  });
  if (!version) throw new Error(`バージョン ${versionCode} がありません`);
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
  });
  if (!source) throw new Error(`データソース種別 ${SOURCE_CODE} がありません`);

  const jobs = only.length > 0 ? JOBS.filter((j) => only.includes(j.category)) : JOBS;
  console.log(`${version.code} × ${source.code} に取り込みます（${jobs.length} 区分）`);
  // **同じ区分に取り出しが2つあることがある**（毒劇法）。2本目からは消さずに足す
  const done = new Set<string>();
  for (const job of jobs) {
    const key = `${job.law}/${job.category}`;
    await run(job, version.id, source.id, done.has(key));
    done.add(key);
  }

  // 取り込んだ日付を、そのデータソースの行に控える
  await prisma.linkVersionSource.updateMany({
    where: { versionId: version.id, sourceId: source.id },
    data: { loadedAt: new Date() },
  });
}

void main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
