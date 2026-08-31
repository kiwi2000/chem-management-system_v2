/**
 * CHRIP から取った詳細を、本システムに入れる。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/chrip-import.ts        下見
 *   ... scripts/chrip-import.ts --write                                              書き込み
 *
 * 入れるもの
 *   1. **物質マスタ** … そのCASが無ければ作る（コードは CAS-<CAS番号>）
 *   2. **CASリンク** … バージョン 2026Q3・データソース CHRIP で、法文物質名に結び付ける
 *
 * **足すだけ。**既にあるものは触らない。何度流しても結果は同じ。
 * 当てられなかったものは捨てず、理由をつけて数える（あとで見直せるように）。
 */
import { looksLikeCas, normalizeCas } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseDetail } from "./lib/chrip-detail.mjs";
import { normalizeNumber, normalizeName } from "./lib/chrip-match.mjs";

const prisma = new PrismaClient();
const DIR = ".cache/chrip/detail";
const VERSION_CODE = "2026Q3";
const SOURCE_CODE = "CHRIP";
const CODE_PREFIX = "CAS-";
/** CAS番号を持たない物質に付ける独自コードの頭。CHRIP の物質IDをそのまま使う */
const OWN_CODE_PREFIX = "CHRIP-";

/**
 * CHRIP の情報源 → 本システムの法律コード。
 *
 * **区分までは決めない。**どの区分かは番号か名前が決める。
 * ここで区分まで手で書くと、そこが取り違えの元になる。
 */
const LAW_OF: Record<string, string> = {
  "化審法：第一種特定化学物質": "JP-CSCL",
  "化審法：第二種特定化学物質": "JP-CSCL",
  "化審法：監視化学物質": "JP-CSCL",
  "化審法：優先評価化学物質": "JP-CSCL",
  "化審法：特定一般化学物質": "JP-CSCL",
  "化管法 (令和５年度分以降の排出量等の把握や令和５年度以降のSDS提供の対象)": "JP-PRTR",
  // CHRIP は現行の化管法を経産省のSDS制度の名前で載せる。こちらが本体
  "化管法SDS制度 作成・提供方法（経産省）": "JP-PRTR",
  毒物及び劇物取締法: "JP-PDSCA",
  "安衛法：製造等が禁止される有害物等": "JP-ISHA",
  "安衛法：製造の許可を受けるべき有害物": "JP-ISHA",
  "安衛法：名称等を表示し、又は通知すべき危険物及び有害物（ラベル表示・SDS交付義務対象物質）":
    "JP-ISHA",
  "安衛法：特定化学物質等（特化則）": "JP-ISHA",
  "安衛法：有機溶剤等（有機則）": "JP-ISHA",
  "化学兵器の禁止及び特定物質の規制等に関する法律（化学兵器禁止法）": "JP-CWCA",
  大気汚染防止法: "JP-APA",
  水質汚濁防止法: "JP-WPCA",
  土壌汚染対策法: "JP-SCCA",
  "REACH：高懸念物質（SVHC）": "EU-REACH",
  "REACH：制限物質": "EU-REACH",
  "TSCA：化学物質及び混合物の優先度付け、リスク評価並びに規制": "US-TSCA",
  "中国：危険化学品目録（２０１５版）": "CN-HAZCHEM",
  "韓国：化評法( K-REACH)／化管法：有害化学物質、重点管理物質": "KR-KREACH",
};

async function main() {
  const write = process.argv.includes("--write");

  const [version, source] = await Promise.all([
    prisma.linkSetVersion.findFirst({
      where: { code: VERSION_CODE, deletedAt: null },
      select: { id: true },
    }),
    prisma.source.findFirst({
      where: { codeNormalized: SOURCE_CODE, deletedAt: null },
      select: { id: true },
    }),
  ]);
  if (!version) throw new Error(`バージョン ${VERSION_CODE} が無い`);
  if (!source) throw new Error(`データソース ${SOURCE_CODE} が無い`);

  /** 法文物質名を、法律ごとに番号と名前で引けるようにする */
  const subs = await prisma.statutorySubstance.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      officialNumber: true,
      nameJa: true,
      nameOriginal: true,
      regulationClass: { select: { category: { select: { law: { select: { code: true } } } } } },
    },
  });
  const byNum = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) =>
    m.set(k, [...(m.get(k) ?? []), v]);
  for (const s of subs) {
    const law = s.regulationClass.category.law.code;
    const n = normalizeNumber(s.officialNumber);
    if (n) push(byNum, `${law}|${n}`, s.id);
    const nm = normalizeName(s.nameJa ?? s.nameOriginal);
    if (nm) push(byName, `${law}|${nm}`, s.id);
  }

  /** 出したい形: 法文物質名 × CAS */
  const links = new Map<
    string,
    { statutorySubstanceId: string; casNumber: string; casNormalized: string }
  >();
  /** 物質マスタに要るCAS */
  const wantSubstance = new Map<
    string,
    { casNumber: string; nameJa: string; nameEn: string | null }
  >();
  const tally = {
    files: 0,
    entries: 0,
    byNum: 0,
    byName: 0,
    noLaw: 0,
    noHit: 0,
    noCas: 0,
    ownCode: 0,
  };
  const misses: string[] = [];

  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".html"))) {
    tally.files++;
    const d = parseDetail(readFileSync(`${DIR}/${f}`, "utf8"));
    /*
      突合の鍵。**CAS番号が無い物質には、独自コードを付ける。**
      石油留分・アルキル同族体のような UVCB は CHRIP にも CAS が無いが、
      法規制には載っている。鍵が無いと法文物質名と結べず、
      組成に打つこともできない（schema の StatutoryCasLink のとおり、
      突合はどちらも cas_normalized で行う）
    */
    const raw = (d.cas ?? "").trim();
    const hasCas = looksLikeCas(normalizeCas(raw));
    const casNumber = hasCas ? raw : d.cid ? `${OWN_CODE_PREFIX}${d.cid}` : "";
    const casNormalized = casNumber ? normalizeCas(casNumber) : "";
    if (!casNormalized) {
      tally.noCas++;
      continue;
    }
    if (!hasCas) tally.ownCode++;

    /*
      物質そのものは、**リンクが当たったかに関わらず登録する。**
      CHRIP がその物質を規制の対象として載せている以上、
      こちらの区分に当てられなくても「その物質がある」ことは確かで、
      組成に打つときに探せなければ意味がない
      （当てられない理由は misses.tsv に残る）
    */
    if (!wantSubstance.has(casNormalized)) {
      const nameJa = (d.nameJa ?? "").trim();
      const nameEn = (d.nameEn ?? "").trim();
      // 名前が無いものがある（「-」で埋められている）。その時はCAS番号を名前にする
      const usableJa = nameJa && nameJa !== "-" ? nameJa : "";
      const usableEn = nameEn && nameEn !== "-" ? nameEn : "";
      wantSubstance.set(casNormalized, {
        casNumber,
        nameJa: (usableJa || usableEn || casNumber).slice(0, 500),
        nameEn: usableEn.slice(0, 500) || null,
      });
    }

    for (const e of d.entries) {
      const law = LAW_OF[e.source];
      if (!law) {
        tally.noLaw++;
        continue;
      }
      tally.entries++;
      const num = normalizeNumber(e.fields["政令番号"]);
      const nm = normalizeName(e.fields["政令名称"]);
      let ids = num ? byNum.get(`${law}|${num}`) : undefined;
      if (ids?.length) tally.byNum++;
      else {
        ids = nm ? byName.get(`${law}|${nm}`) : undefined;
        if (ids?.length) tally.byName++;
      }
      if (!ids?.length) {
        tally.noHit++;
        misses.push(
          `${law}\t${e.fields["政令番号"] ?? ""}\t${(e.fields["政令名称"] ?? "").slice(0, 40)}\t${casNumber}`,
        );
        continue;
      }
      for (const id of ids)
        links.set(`${id}|${casNormalized}`, { statutorySubstanceId: id, casNumber, casNormalized });
    }
  }

  /** 既にある物質・既にあるリンクを引いて、足すぶんだけにする */
  const casList = [...wantSubstance.keys()];
  const known = new Set(
    (
      await prisma.substance.findMany({
        where: { casNormalized: { in: casList }, deletedAt: null },
        select: { casNormalized: true },
      })
    ).map((s) => s.casNormalized!),
  );
  const newCas = casList.filter((c) => !known.has(c));
  const existing = new Set(
    (
      await prisma.statutoryCasLink.findMany({
        where: { versionId: version.id, sourceId: source.id },
        select: { statutorySubstanceId: true, casNormalized: true },
      })
    ).map((l) => `${l.statutorySubstanceId}|${l.casNormalized}`),
  );
  const newLinks = [...links.values()].filter(
    (l) => !existing.has(`${l.statutorySubstanceId}|${l.casNormalized}`),
  );

  console.log(`読んだ詳細: ${tally.files.toLocaleString()} 件`);
  console.log(
    `  当てにいった対応: ${tally.entries.toLocaleString()}（番号 ${tally.byNum.toLocaleString()} / 名前 ${tally.byName.toLocaleString()} / 当たらず ${tally.noHit.toLocaleString()}）`,
  );
  console.log(`  対象外の情報源として飛ばした: ${tally.noLaw.toLocaleString()}`);
  console.log(
    `CAS番号（重複なし）: ${casList.length.toLocaleString()}（うち物質マスタに無い ${newCas.length.toLocaleString()}）`,
  );
  console.log(
    `  うち独自コード（CAS番号が無い物質）: ${tally.ownCode.toLocaleString()} 件 / 鍵を作れなかった: ${tally.noCas.toLocaleString()} 件`,
  );
  console.log(
    `CASリンク: ${links.size.toLocaleString()}（うち未登録 ${newLinks.length.toLocaleString()}）`,
  );
  if (misses.length) writeFileSync(".cache/chrip/misses.tsv", misses.join("\n"));

  if (!write) {
    console.log("\n下見だけ。書き込むなら --write を付ける");
    return;
  }

  // 1. 物質マスタ
  if (newCas.length) {
    await prisma.substance.createMany({
      data: newCas.map((cas) => {
        const w = wantSubstance.get(cas)!;
        // 独自コードの物質は、そのコードがそのまま業務キーになる
        const code = cas.startsWith(OWN_CODE_PREFIX) ? cas : `${CODE_PREFIX}${cas}`;
        return {
          code: code.slice(0, 20),
          codeNormalized: code.slice(0, 64),
          nameJa: w.nameJa,
          nameEn: w.nameEn,
          casNumber: w.casNumber,
          casNormalized: cas,
          publishState: "PUBLISHED" as const,
        };
      }),
      skipDuplicates: true,
    });
    console.log(`物質を登録: ${newCas.length.toLocaleString()} 件`);
  }
  // 2. CASリンク
  for (let i = 0; i < newLinks.length; i += 1000) {
    const chunk = newLinks.slice(i, i + 1000);
    await prisma.statutoryCasLink.createMany({
      data: chunk.map((l) => ({ versionId: version.id, sourceId: source.id, ...l })),
      skipDuplicates: true,
    });
  }
  console.log(`CASリンクを登録: ${newLinks.length.toLocaleString()} 件`);
}

main().finally(() => prisma.$disconnect());
