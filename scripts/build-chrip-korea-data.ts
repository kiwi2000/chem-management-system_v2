/**
 * CHRIP の詳細から、韓国（化評法／化管法）の規制区分・法文物質名・CASを取り出す。
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/build-chrip-korea-data.ts
 *
 * 出力は scripts/data/chrip-korea.json。取り込みは scripts/seed-chrip-korea.ts。
 *
 * ## CHRIP だけで組み立てる
 *
 * **LOLI を見ない。**お客様によっては CHRIP しか契約していないため、
 * CHRIP から作るデータは CHRIP の中だけで成り立たせる
 * （`docs/法規制データの作り方.md` 第0章 0-2）。
 *
 * ## 詳細ページの読みかた
 *
 * 情報源「韓国：化評法( K-REACH)／化管法：有害化学物質、重点管理物質」の箱には、
 * **カテゴリごとの記載がいくつも並ぶ。**4項目で1つの記載になる。
 *
 *   NIER番号  06-4-49    カテゴリ Prohibited Substances  対象となる範囲（％） >=1
 *   NIER番号  97-1-339   カテゴリ Toxic Substances       対象となる範囲（％） Acutely:1%, Environment:25%
 *
 * 同じ物質が禁止物質と有害化学物質の両方に載ることがある（上はその例）。
 *
 * ## 毒性物質（Toxic Substances）を3つに分ける
 *
 * 毒性物質は、有害性の種類ごとに閾値が違う。頭に付く語がその種類を表す。
 *
 *   Acutely:      人の健康への急性の有害性   → TOXIC_ACUTE
 *   Chronically:  人の健康への慢性の有害性   → TOXIC_CHRONIC
 *   Environment:  生態への有害性             → TOXIC_ECO
 *
 * 1つの区分にまとめると閾値を1つしか持てないので、3つの区分に分ける。
 *
 * ## 閾値の読みかた
 *
 * `対象となる範囲（％）` は含有率の下限で、**その値以上**が対象。
 * `>=1` も `Acutely:1%` も同じ意味に読む（`>=` の有無は書き方の違い）。
 * 範囲の記載が無いものは下限を置かない。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { looksLikeCas, normalizeCas } from "@chem/shared";
import { parseDetail } from "./lib/chrip-detail.mjs";

const DIR = ".cache/chrip/detail";
const OUT = "scripts/data/chrip-korea.json";
const SOURCE = "韓国：化評法( K-REACH)／化管法：有害化学物質、重点管理物質";

/** カテゴリ → 法律と規制区分。頭に付く語で分かれるものは PREFIX へ */
const CATEGORY_OF: Record<string, { law: string; category: string }> = {
  "Prohibited Substances": { law: "KR-KREACH", category: "PROHIBITED" },
  "Restricted Substances": { law: "KR-KREACH", category: "RESTRICTED" },
  "Substances subject to intensive control": { law: "KR-KREACH", category: "PRIORITY" },
  "Substances requiring preparation for accidents": { law: "KR-CCA", category: "ACCIDENT" },
};

/**
 * 毒性物質の頭に付く語 → 規制区分。
 *
 * 毒性物質（유독물질）は**化管法（`KR-CCA`）の指定。**禁止物質・制限物質は
 * 化評法（K-REACH）第27条の指定で、化管法はそれを引いているだけ。
 */
const PREFIX_OF: Record<string, string> = {
  Acutely: "TOXIC_ACUTE",
  Chronically: "TOXIC_CHRONIC",
  Environment: "TOXIC_ECO",
};

interface Item {
  law: string;
  category: string;
  number: string;
  nameEn: string;
  lower: string | null;
  cas: string[];
}

/** `>=1` を読む。読めなければ null */
function plainLower(raw: string | undefined): string | null {
  const m = /^>=\s*([\d.]+)$/.exec((raw ?? "").trim());
  return m ? m[1]! : null;
}

/** `Acutely:1%, Environment:25%` を「区分 → 下限」に分ける */
function byPrefix(raw: string | undefined): { category: string; lower: string }[] {
  const out: { category: string; lower: string }[] = [];
  for (const part of (raw ?? "").split(",")) {
    const m = /^\s*([A-Za-z]+)\s*:\s*([\d.]+)\s*%?\s*$/.exec(part);
    const category = m ? PREFIX_OF[m[1]!] : undefined;
    if (m && category) out.push({ category, lower: m[2]! });
  }
  return out;
}

function main() {
  /** 区分 × 号 でまとめる */
  const items = new Map<string, Item & { names: Set<string>; lowers: Set<string> }>();
  const skipped: string[] = [];
  const tally = { files: 0, blocks: 0, noNumber: 0, noCategory: 0, noPrefix: 0 };

  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".html"))) {
    const d = parseDetail(readFileSync(`${DIR}/${f}`, "utf8"));
    const blocks = d.entries.filter((e) => e.source === SOURCE);
    if (blocks.length === 0) continue;
    tally.files += 1;

    const raw = (d.cas ?? "").trim();
    const cas = looksLikeCas(normalizeCas(raw)) ? raw : "";

    for (const b of blocks) {
      tally.blocks += 1;
      const number = (b.fields["NIER番号"] ?? "").trim();
      const label = (b.fields["カテゴリ"] ?? "").trim();
      const nameEn = (b.fields["化学物質名称"] ?? "").trim();
      const range = b.fields["対象となる範囲（％）"];
      if (!number) {
        tally.noNumber += 1;
        skipped.push(`${f}\t番号なし\t${label}\t${nameEn}`);
        continue;
      }

      /** 行き先。有害化学物質は頭に付く語で3つに分かれる */
      let targets: { law: string; category: string; lower: string | null }[];
      if (label === "Toxic Substances") {
        const split = byPrefix(range);
        if (split.length === 0) {
          tally.noPrefix += 1;
          skipped.push(`${f}\t頭の語が無い\t${number}\t${range ?? ""}`);
          continue;
        }
        targets = split.map((s) => ({ law: "KR-CCA", category: s.category, lower: s.lower }));
      } else {
        const to = CATEGORY_OF[label];
        if (!to) {
          tally.noCategory += 1;
          skipped.push(`${f}\t知らないカテゴリ\t${label}\t${number}`);
          continue;
        }
        targets = [{ ...to, lower: plainLower(range) }];
      }

      for (const t of targets) {
        const key = `${t.law}|${t.category}|${number}`;
        const found = items.get(key) ?? {
          law: t.law,
          category: t.category,
          number,
          nameEn: "",
          lower: null,
          cas: [],
          names: new Set<string>(),
          lowers: new Set<string>(),
        };
        if (nameEn) found.names.add(nameEn);
        if (t.lower) found.lowers.add(t.lower);
        if (cas) found.cas.push(cas);
        items.set(key, found);
      }
    }
  }

  const out: Item[] = [];
  let manyLowers = 0;
  for (const v of [...items.values()]) {
    /*
      同じ号に閾値が2つ以上あるとき（物質によって書き分けられている）は、
      **もっとも広く該当するもの＝いちばん小さい下限**を採る。
      利用者の決めごとのとおり（`docs/法規制データの作り方.md` 0-2b）
    */
    const lowers = [...v.lowers].sort((a, b) => Number(a) - Number(b));
    if (lowers.length > 1) manyLowers += 1;
    out.push({
      law: v.law,
      category: v.category,
      number: v.number,
      nameEn: [...v.names].join(" / "),
      lower: lowers[0] ?? null,
      cas: [...new Set(v.cas)].sort(),
    });
  }
  out.sort(
    (a, b) =>
      a.law.localeCompare(b.law) ||
      a.category.localeCompare(b.category) ||
      a.number.localeCompare(b.number),
  );

  writeFileSync(OUT, `${JSON.stringify({ source: "CHRIP", items: out }, null, 2)}\n`);

  const per = new Map<string, { n: number; cas: number }>();
  for (const i of out) {
    const k = `${i.law}/${i.category}`;
    const e = per.get(k) ?? { n: 0, cas: 0 };
    e.n += 1;
    e.cas += i.cas.length;
    per.set(k, e);
  }
  console.log(`詳細 ${tally.files.toLocaleString()} 件 / 記載 ${tally.blocks.toLocaleString()} 件`);
  for (const [k, e] of [...per].sort())
    console.log(`  ${k.padEnd(24)} 号 ${String(e.n).padStart(5)} 件 / CAS ${e.cas} 件`);
  console.log(`\n閾値が2つ以上あった号: ${manyLowers} 件（いちばん小さい下限を採った）`);
  if (skipped.length) {
    console.log(`\n**入れられなかった記載: ${skipped.length} 件**`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  console.log(`\n書き出しました: ${OUT}`);
}

main();
