/**
 * ローカルで作った法規制・インベントリ・物質マスタを、本番へ写す。
 *
 *   railway connect Postgres --tunnel-only        別の窓で開いておく
 *   （出てきた URL を .cache/prod.env に PROD_URL=… として書く）
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/copy-to-prod.ts            下見
 *   ... scripts/copy-to-prod.ts --write   書き込み
 *
 * **足すだけ。**本番にある行は消さないし、書き換えもしない。
 * 本番だけにあるもの（利用者・製品・記録）には触れない。
 *
 * **idは両側で違う。**同じ内容でも別々に作ったので、cuid が一致しない。
 * そのため、対応づけは**コードで行う**。本番に無いものを写すときだけ、
 * ローカルのidをそのまま持っていく（ぶつかりようがないため）。
 * これで途中で止まっても、もう一度流せば続きから入る。
 *
 * 写す順は、参照される側から。
 *
 *   言語 → 国 → データソース → バージョン → バージョン×データソース
 *   → 法令 → 規制区分 → 分類 → 法文物質名
 *   → 物質マスタ
 *   → インベントリ → インベントリの行
 *   → CASリンク
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prodUrl = readFileSync(".cache/prod.env", "utf-8")
  .trim()
  .replace(/^PROD_URL=/, "");
const localUrl = /DATABASE_URL="?([^"\n\r]+)"?/.exec(readFileSync(".env", "utf-8"))![1];
const L = new PrismaClient({ datasources: { db: { url: localUrl } } });
const P = new PrismaClient({ datasources: { db: { url: prodUrl } } });

const write = process.argv.includes("--write");
/** 1回のINSERTに載せる行数。トンネル越しなので大きすぎると詰まる */
const CHUNK = 5000;

const log = (s: string) => console.log(s);

/** 進み具合を1行で出す。大きい表で音沙汰が無くならないように */
function progress(label: string, done: number, total: number) {
  const pct = total === 0 ? 100 : Math.floor((done / total) * 100);
  process.stdout.write(`\r  ${label} ${done}/${total} (${pct}%)   `);
  if (done >= total) process.stdout.write("\n");
}

/** 本番へまとめて入れる。すでにある行は飛ばす */
async function push<T>(
  label: string,
  rows: T[],
  insert: (batch: T[]) => Promise<{ count: number }>,
) {
  if (rows.length === 0) {
    log(`  ${label} 足すものはありません`);
    return 0;
  }
  if (!write) {
    log(`  ${label} ${rows.length} 件を足す予定`);
    return rows.length;
  }
  let done = 0;
  let added = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const r = await insert(batch);
    added += r.count;
    done += batch.length;
    progress(label, done, rows.length);
  }
  return added;
}

async function main() {
  log(write ? "本番へ書き込みます\n" : "下見（--write で書き込み）\n");

  // --- 1 言語 ---------------------------------------------------------------
  const lLang = await L.language.findMany();
  const pLang = new Set((await P.language.findMany({ select: { code: true } })).map((x) => x.code));
  await push(
    "言語        ",
    lLang.filter((x) => !pLang.has(x.code)),
    (b) => P.language.createMany({ data: b, skipDuplicates: true }),
  );

  // --- 2 国（地域はコードで対応づける） ---------------------------------------
  const pRegion = new Map(
    (await P.region.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.codeNormalized,
      x.id,
    ]),
  );
  const lRegion = new Map(
    (await L.region.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.id,
      x.codeNormalized,
    ]),
  );
  const lCountry = await L.country.findMany();
  const pCountryByCode = new Map(
    (await P.country.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.codeNormalized,
      x.id,
    ]),
  );
  await push(
    "国          ",
    lCountry
      .filter((x) => !pCountryByCode.has(x.codeNormalized))
      .map((x) => ({ ...x, regionId: pRegion.get(lRegion.get(x.regionId)!)! })),
    (b) => P.country.createMany({ data: b, skipDuplicates: true }),
  );
  // 足したぶんを引き直す。あとでインベントリと法令が参照する
  const country = new Map(
    (await P.country.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.codeNormalized,
      x.id,
    ]),
  );
  const lCountryCode = new Map(lCountry.map((x) => [x.id, x.codeNormalized]));

  // --- 3 データソース --------------------------------------------------------
  const lSource = await L.source.findMany();
  const pSourceCode = new Set(
    (await P.source.findMany({ select: { codeNormalized: true } })).map((x) => x.codeNormalized),
  );
  await push(
    "データソース",
    lSource.filter((x) => !pSourceCode.has(x.codeNormalized)),
    (b) => P.source.createMany({ data: b, skipDuplicates: true }),
  );
  const source = new Map(
    (await P.source.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.codeNormalized,
      x.id,
    ]),
  );
  const lSourceCode = new Map(lSource.map((x) => [x.id, x.codeNormalized]));
  /** ローカルのデータソースid → 本番のid */
  const srcOf = (id: string) => source.get(lSourceCode.get(id)!)!;

  // --- 4 バージョン ----------------------------------------------------------
  const lVersion = await L.linkSetVersion.findMany();
  const pVersionCode = new Set(
    (await P.linkSetVersion.findMany({ select: { codeNormalized: true } })).map(
      (x) => x.codeNormalized,
    ),
  );
  await push(
    "バージョン  ",
    lVersion
      .filter((x) => !pVersionCode.has(x.codeNormalized))
      // **現在のバージョンは本番の決めかたに任せる。**こちらから切り替えない
      .map((x) => ({ ...x, isCurrent: false })),
    (b) => P.linkSetVersion.createMany({ data: b, skipDuplicates: true }),
  );
  const version = new Map(
    (await P.linkSetVersion.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.codeNormalized,
      x.id,
    ]),
  );
  const lVersionCode = new Map(lVersion.map((x) => [x.id, x.codeNormalized]));
  /** ローカルのバージョンid → 本番のid */
  const verOf = (id: string) => version.get(lVersionCode.get(id)!)!;

  // --- 5 バージョン×データソース（優先度） -------------------------------------
  const lLvs = await L.linkVersionSource.findMany();
  const pLvs = new Set(
    (await P.linkVersionSource.findMany({ select: { versionId: true, sourceId: true } })).map(
      (x) => `${x.versionId}/${x.sourceId}`,
    ),
  );
  await push(
    "優先度      ",
    lLvs
      .map((x) => ({ ...x, versionId: verOf(x.versionId), sourceId: srcOf(x.sourceId) }))
      .filter((x) => x.versionId && x.sourceId && !pLvs.has(`${x.versionId}/${x.sourceId}`)),
    (b) => P.linkVersionSource.createMany({ data: b, skipDuplicates: true }),
  );

  // --- 6 法令・規制区分・分類・法文物質名 --------------------------------------
  const lLaw = await L.law.findMany();
  const pLawCode = new Map(
    (await P.law.findMany({ select: { id: true, codeNormalized: true } })).map((x) => [
      x.codeNormalized,
      x.id,
    ]),
  );
  const newLaws = lLaw.filter((x) => !pLawCode.has(x.codeNormalized));
  log(`\n法令で本番に無いもの: ${newLaws.map((x) => x.code).join(" ") || "なし"}`);
  await push(
    "法令        ",
    newLaws.map((x) => ({ ...x, countryId: country.get(lCountryCode.get(x.countryId)!)! })),
    (b) => P.law.createMany({ data: b, skipDuplicates: true }),
  );

  const newLawIds = new Set(newLaws.map((x) => x.id));
  const lCat = await L.regulationCategory.findMany({ where: { lawId: { in: [...newLawIds] } } });
  await push("規制区分    ", lCat, (b) =>
    P.regulationCategory.createMany({ data: b, skipDuplicates: true }),
  );
  const lCls = await L.regulationClass.findMany({
    where: { categoryId: { in: lCat.map((x) => x.id) } },
  });
  await push("分類        ", lCls, (b) =>
    P.regulationClass.createMany({ data: b, skipDuplicates: true }),
  );
  const lSub = await L.statutorySubstance.findMany({
    where: { classId: { in: lCls.map((x) => x.id) } },
  });
  await push("法文物質名  ", lSub, (b) =>
    P.statutorySubstance.createMany({ data: b, skipDuplicates: true }),
  );

  // --- 7 物質マスタ ----------------------------------------------------------
  log("");
  const pSubstCode = new Set(
    (await P.substance.findMany({ select: { codeNormalized: true } })).map((x) => x.codeNormalized),
  );
  const lSubst = await L.substance.findMany();
  await push(
    "物質マスタ  ",
    lSubst.filter((x) => !pSubstCode.has(x.codeNormalized)),
    (b) => P.substance.createMany({ data: b, skipDuplicates: true }),
  );

  // --- 8 インベントリ --------------------------------------------------------
  log("");
  const lInv = await L.inventory.findMany();
  const pInvCode = new Set(
    (await P.inventory.findMany({ select: { codeNormalized: true } })).map((x) => x.codeNormalized),
  );
  await push(
    "インベントリ",
    lInv
      .filter((x) => !pInvCode.has(x.codeNormalized))
      .map((x) => ({ ...x, countryId: country.get(lCountryCode.get(x.countryId)!)! })),
    (b) => P.inventory.createMany({ data: b, skipDuplicates: true }),
  );

  /*
    行は本数が多い（190万）。バージョンと目録の組ごとに、
    **本番が0件のときだけ**まるごと写す。途中で止まっても、
    入り終わった組は次は飛ばす
  */
  for (const inv of lInv) {
    for (const v of lVersion) {
      const pv = verOf(v.id);
      const already = await P.inventoryRow.count({ where: { inventoryId: inv.id, versionId: pv } });
      const n = await L.inventoryRow.count({ where: { inventoryId: inv.id, versionId: v.id } });
      if (n === 0) continue;
      /*
        **途中まで入っているときは続きから入れる。**
        0件でないだけで飛ばすと、止まった組がずっと欠けたままになる
        （実際に TSCA 2026Q3 が8%で止まった）。
        idはローカルのものを持っていくので、入れ直しても重複にならない
      */
      if (already >= n) {
        log(`  ${inv.code} ${v.code} 済み（${already} 件）`);
        continue;
      }
      if (already > 0) log(`  ${inv.code} ${v.code} 途中から（${already}/${n} 件）`);
      if (!write) {
        log(`  ${inv.code} ${v.code} ${n} 件を足す予定`);
        continue;
      }
      let done = 0;
      let cursor: string | undefined;
      for (;;) {
        const batch = await L.inventoryRow.findMany({
          where: { inventoryId: inv.id, versionId: v.id },
          take: CHUNK,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          orderBy: { id: "asc" },
        });
        if (batch.length === 0) break;
        cursor = batch[batch.length - 1].id;
        await P.inventoryRow.createMany({
          data: batch.map((r) => ({ ...r, versionId: pv, sourceId: srcOf(r.sourceId) })),
          skipDuplicates: true,
        });
        done += batch.length;
        progress(`${inv.code} ${v.code}`, done, n);
      }
    }
  }

  // --- 9 CASリンク -----------------------------------------------------------
  log("");
  /*
    法文物質名のidは両側で違う。**コードの道筋で対応づける**。
    法令コード/区分コード/分類コード/法文物質名コード の4つで1つに決まる
  */
  const keyOf = (r: { lawCode: string; catCode: string; clsCode: string; subCode: string }) =>
    `${r.lawCode}/${r.catCode}/${r.clsCode}/${r.subCode}`;
  const pathSql = `
    SELECT ss.id,
           l.code_normalized  AS "lawCode",
           c.code_normalized  AS "catCode",
           rc.code_normalized AS "clsCode",
           ss.code_normalized AS "subCode"
    FROM statutory_substances ss
    JOIN regulation_classes rc ON rc.id = ss.class_id
    JOIN regulation_categories c ON c.id = rc.category_id
    JOIN laws l ON l.id = c.law_id`;
  type Path = { id: string; lawCode: string; catCode: string; clsCode: string; subCode: string };
  const pPaths = (await P.$queryRawUnsafe(pathSql)) as Path[];
  const lPaths = (await L.$queryRawUnsafe(pathSql)) as Path[];
  const prodSubOf = new Map(pPaths.map((r) => [keyOf(r), r.id]));
  const localKey = new Map(lPaths.map((r) => [r.id, keyOf(r)]));
  log(`  法文物質名の対応: 本番 ${pPaths.length} 件 / ローカル ${lPaths.length} 件`);

  /* バージョン×法令の組ごとに、本番が0件のときだけ写す */
  const groups = (await L.$queryRawUnsafe(`
    SELECT v.code_normalized AS ver, l.code_normalized AS law, COUNT(*)::int AS n
    FROM statutory_cas_links k
    JOIN link_set_versions v ON v.id = k.version_id
    JOIN statutory_substances ss ON ss.id = k.statutory_substance_id
    JOIN regulation_classes rc ON rc.id = ss.class_id
    JOIN regulation_categories c ON c.id = rc.category_id
    JOIN laws l ON l.id = c.law_id
    GROUP BY v.code_normalized, l.code_normalized ORDER BY v.code_normalized, l.code_normalized`)) as {
    ver: string;
    law: string;
    n: number;
  }[];

  let missing = 0;
  for (const g of groups) {
    /*
      **本番にそのバージョンが無いときは止める。**
      undefined のまま数えると Prisma が条件ごと無視し、
      別のバージョンの件数を「済み」と読み違える
    */
    const pv = version.get(g.ver);
    if (!pv) {
      log(`  ${g.ver} ${g.law} 本番にバージョンがありません（下見では作らないため）`);
      continue;
    }
    const subIds = lPaths.filter((r) => r.lawCode === g.law).map((r) => r.id);
    const already = await P.statutoryCasLink.count({
      where: {
        versionId: pv,
        statutorySubstanceId: {
          in: [...prodSubOf].filter(([k]) => k.startsWith(`${g.law}/`)).map(([, v]) => v),
        },
      },
    });
    // 途中で止まった組は入れ直す（idは持っていくので重複にならない）
    if (already >= g.n) {
      log(`  ${g.ver} ${g.law} 済み（${already} 件）`);
      continue;
    }
    if (already > 0) log(`  ${g.ver} ${g.law} 途中から（${already}/${g.n} 件）`);
    if (!write) {
      log(`  ${g.ver} ${g.law} ${g.n} 件を足す予定`);
      continue;
    }
    let done = 0;
    let cursor: string | undefined;
    for (;;) {
      const batch = await L.statutoryCasLink.findMany({
        where: {
          versionId: lVersion.find((x) => x.codeNormalized === g.ver)!.id,
          statutorySubstanceId: { in: subIds },
        },
        take: CHUNK,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: "asc" },
      });
      if (batch.length === 0) break;
      cursor = batch[batch.length - 1].id;
      const data = [];
      for (const r of batch) {
        const id = prodSubOf.get(localKey.get(r.statutorySubstanceId)!);
        if (!id) {
          missing += 1;
          continue;
        }
        data.push({ ...r, statutorySubstanceId: id, versionId: pv, sourceId: srcOf(r.sourceId) });
      }
      if (data.length > 0) {
        await P.statutoryCasLink.createMany({ data, skipDuplicates: true });
      }
      done += batch.length;
      progress(`${g.ver} ${g.law}`, done, g.n);
    }
  }
  if (missing > 0) log(`  対応する法文物質名が本番に無く、飛ばしたリンク: ${missing} 件`);

  // --- 10 表示順 -------------------------------------------------------------
  /*
    **並び順はあとから変わる。**画面で行を引いて動かせるようにしたので、
    法令や国を作り直さなくても番号だけが変わる。コードで突き合わせて写す。
    ここだけは「足す」ではなく**書き換え**になる（並びはローカルが正）
  */
  log("");
  const wantRegion = new Map(
    (await L.region.findMany({ select: { codeNormalized: true, displayOrder: true } })).map((x) => [
      x.codeNormalized,
      x.displayOrder,
    ]),
  );
  const pRegionRows = await P.region.findMany({
    select: { id: true, codeNormalized: true, displayOrder: true },
  });
  const regionDiff = pRegionRows.filter(
    (x) => wantRegion.has(x.codeNormalized) && wantRegion.get(x.codeNormalized) !== x.displayOrder,
  );
  if (write) {
    for (const row of regionDiff) {
      await P.region.update({
        where: { id: row.id },
        data: { displayOrder: wantRegion.get(row.codeNormalized)! },
      });
    }
  }

  const wantCountry = new Map(
    (await L.country.findMany({ select: { codeNormalized: true, displayOrder: true } })).map(
      (x) => [x.codeNormalized, x.displayOrder],
    ),
  );
  const pCountryRows = await P.country.findMany({
    select: { id: true, codeNormalized: true, displayOrder: true },
  });
  const countryDiff = pCountryRows.filter(
    (x) =>
      wantCountry.has(x.codeNormalized) && wantCountry.get(x.codeNormalized) !== x.displayOrder,
  );
  if (write) {
    for (const row of countryDiff) {
      await P.country.update({
        where: { id: row.id },
        data: { displayOrder: wantCountry.get(row.codeNormalized)! },
      });
    }
  }

  const wantLaw = new Map(
    (await L.law.findMany({ select: { codeNormalized: true, displayOrder: true } })).map((x) => [
      x.codeNormalized,
      x.displayOrder,
    ]),
  );
  const pLawRows = await P.law.findMany({
    select: { id: true, codeNormalized: true, displayOrder: true },
  });
  const lawDiff = pLawRows.filter(
    (x) => wantLaw.has(x.codeNormalized) && wantLaw.get(x.codeNormalized) !== x.displayOrder,
  );
  if (write) {
    for (const row of lawDiff) {
      await P.law.update({
        where: { id: row.id },
        data: { displayOrder: wantLaw.get(row.codeNormalized)! },
      });
    }
  }

  /* 区分のコードは法令の中でしか決まらないので、法令のコードと組にして突き合わせる */
  const lCatRows = await L.regulationCategory.findMany({
    select: {
      id: true,
      codeNormalized: true,
      displayOrder: true,
      law: { select: { codeNormalized: true } },
    },
  });
  const pCatRows = await P.regulationCategory.findMany({
    select: {
      id: true,
      codeNormalized: true,
      displayOrder: true,
      law: { select: { codeNormalized: true } },
    },
  });
  const catKey = (x: { codeNormalized: string; law: { codeNormalized: string } }) =>
    `${x.law.codeNormalized}/${x.codeNormalized}`;
  const wantCat = new Map(lCatRows.map((x) => [catKey(x), x.displayOrder]));
  const catDiff = pCatRows.filter(
    (x) => wantCat.has(catKey(x)) && wantCat.get(catKey(x)) !== x.displayOrder,
  );
  if (write) {
    for (const row of catDiff) {
      await P.regulationCategory.update({
        where: { id: row.id },
        data: { displayOrder: wantCat.get(catKey(row))! },
      });
    }
  }
  for (const [label, n] of [
    ["地域    ", regionDiff.length],
    ["国      ", countryDiff.length],
    ["法令    ", lawDiff.length],
    ["規制区分", catDiff.length],
  ] as const) {
    log(`  ${label} 表示順が違う ${n} 件${write && n > 0 ? "（直しました）" : ""}`);
  }

  // --- 11 見本の製品 ---------------------------------------------------------
  /*
    本番にまだ無い製品を写す。組成と、そこから作った展開・判定まで一緒に。
    **本番で判定し直さない。**やり直すと、本番で人が確定した判定まで消えてしまう。

    **コードで見て、無いものだけ足す。**接頭辞では絞らない。
    見本の製品は増えるたびに新しい接頭辞が付き（`VS-` `CP-` `MX-` …）、
    絞り込みを書き足し忘れると、写したつもりのものが黙って抜ける。
    下見（`--write` なし）でコードが並ぶので、何が行くかは実行前に読める
  */
  log("");
  const sample = await L.product.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, codeNormalized: true },
    orderBy: { code: "asc" },
  });
  const pProducts = await P.product.findMany({
    select: { id: true, codeNormalized: true },
  });
  const pSampleCode = new Set(pProducts.map((x) => x.codeNormalized));
  const newSample = sample.filter((x) => !pSampleCode.has(x.codeNormalized));
  if (newSample.length === 0) {
    log("  見本の製品  足すものはありません");
  } else if (!write) {
    log(`  見本の製品  ${newSample.map((x) => x.code).join(" ")} を足す予定`);
  } else {
    const ids = newSample.map((x) => x.id);
    /*
      ローカルの物質id → 本番の物質id。
      **コードで引き、駄目ならCASで引く。**同じ物質でも
      両側で別々にコードが付いていることがある（トルエンなど20件）。
      CAS でも引けないものが組成に出てきたら、そこで止める
      （黙って空にすると、組成の行が「物質でも原材料でもない」ものになる）
    */
    const pSubstRows = await P.substance.findMany({
      where: { deletedAt: null },
      select: { id: true, codeNormalized: true, casNormalized: true, isCasRepresentative: true },
    });
    const pByCode = new Map(pSubstRows.map((x) => [x.codeNormalized, x.id]));
    const pByCas = new Map(
      pSubstRows
        .filter((x) => x.isCasRepresentative && x.casNormalized)
        .map((x) => [x.casNormalized!, x.id]),
    );
    const substOf = new Map(
      (
        await L.substance.findMany({
          select: { id: true, codeNormalized: true, casNormalized: true },
        })
      ).flatMap((x) => {
        const hit =
          pByCode.get(x.codeNormalized) ??
          (x.casNormalized ? pByCas.get(x.casNormalized) : undefined);
        return hit ? [[x.id, hit] as [string, string]] : [];
      }),
    );
    /** ローカルの区分id → 本番の区分id */
    const pCatById = new Map(pCatRows.map((x) => [catKey(x), x.id]));
    const catOf = new Map(
      lCatRows.flatMap((x) => {
        const hit = pCatById.get(catKey(x));
        return hit ? [[x.id, hit] as [string, string]] : [];
      }),
    );

    /*
      作った人・直した人。**idは両側で違う**ので、メールアドレスで引き直す。
      そのまま持っていくと、本番に無いidを指したまま「作成者」が出せなくなる
    */
    const pUserByMail = new Map(
      (await P.user.findMany({ select: { id: true, email: true } })).map((x) => [x.email, x.id]),
    );
    const userOf = new Map(
      (await L.user.findMany({ select: { id: true, email: true } })).flatMap((x) => {
        const hit = pUserByMail.get(x.email);
        return hit ? [[x.id, hit] as [string, string]] : [];
      }),
    );
    const whoOf = (id: string | null) => (id ? (userOf.get(id) ?? null) : null);

    const rows = await L.product.findMany({ where: { id: { in: ids } } });
    await P.product.createMany({
      data: rows.map((x) => ({
        ...x,
        createdBy: whoOf(x.createdBy),
        updatedBy: whoOf(x.updatedBy),
      })),
      skipDuplicates: true,
    });

    /*
      原材料として使っている製品。**本番に前からある製品は、idが違う。**
      （本番の見本は別に投入されたもので、こちらのidとは一致しない）
      いま写したものは同じidで入るので、そちらはそのまま通る
    */
    const pProdByCode = new Map(pProducts.map((x) => [x.codeNormalized, x.id]));
    const lCodeOf = new Map(sample.map((x) => [x.id, x.codeNormalized]));
    const justCopied = new Set(ids);
    function childOf(id: string | null): string | null {
      if (!id || justCopied.has(id)) return id;
      const hit = pProdByCode.get(lCodeOf.get(id) ?? "");
      if (!hit) throw new Error(`本番に見つからない原材料が組成にあります: ${lCodeOf.get(id)}`);
      return hit;
    }

    const lines = await L.compositionLine.findMany({ where: { parentProductId: { in: ids } } });
    const lost = lines.filter((x) => x.substanceId && !substOf.has(x.substanceId));
    if (lost.length > 0) {
      throw new Error(`本番に見つからない物質が組成にあります: ${lost.length} 行`);
    }
    await P.compositionLine.createMany({
      data: lines.map((x) => ({
        ...x,
        substanceId: x.substanceId ? substOf.get(x.substanceId)! : null,
        childProductId: childOf(x.childProductId),
      })),
      skipDuplicates: true,
    });
    await P.productExpansion.createMany({
      data: await L.productExpansion.findMany({ where: { productId: { in: ids } } }),
      skipDuplicates: true,
    });
    const exLines = await L.productExpansionLine.findMany({ where: { productId: { in: ids } } });
    await P.productExpansionLine.createMany({
      data: exLines.map((x) => ({
        ...x,
        substanceId: x.substanceId ? (substOf.get(x.substanceId) ?? null) : null,
      })),
      skipDuplicates: true,
    });
    const judge = await L.productJudgement.findMany({ where: { productId: { in: ids } } });
    const kept = judge.filter((x) => catOf.has(x.categoryId));
    await P.productJudgement.createMany({
      data: kept.map((x) => ({ ...x, categoryId: catOf.get(x.categoryId)! })),
      skipDuplicates: true,
    });
    const hits = await L.productJudgementHit.findMany({
      where: { judgementId: { in: kept.map((x) => x.id) } },
    });
    await P.productJudgementHit.createMany({
      data: hits.map((x) => ({
        ...x,
        statutorySubstanceId: x.statutorySubstanceId
          ? (prodSubOf.get(localKey.get(x.statutorySubstanceId) ?? "") ?? null)
          : null,
      })),
      skipDuplicates: true,
    });
    log(
      `  見本の製品  ${newSample.map((x) => x.code).join(" ")}` +
        `（組成 ${lines.length} 行 / 展開 ${exLines.length} 行 / 判定 ${kept.length} 件）`,
    );
  }

  log("\n終わりました。");
  await L.$disconnect();
  await P.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await L.$disconnect();
  await P.$disconnect();
  process.exitCode = 1;
});
