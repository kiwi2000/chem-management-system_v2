/**
 * CHRIP から取った IARC の発がん性評価を、CAS リンクとして入れる（データソース CHRIP）。
 * 法文物質名は seed-iarc-laws.ts（IARC の正式一覧）。
 *
 *   python scripts/chrip-iarc-extract.py                              先に抜き出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-iarc-chrip-links.ts 2026Q3 --write
 *
 * **CHRIP は LOLI を見ずに作る**（データソースは単独で成り立たせる）。
 * CHRIP の `Agent名称` は正式一覧の書きかたをほぼそのまま写しているので、名前で当たる。
 * 当たらなければ CAS で当て、それでも無ければ CHRIP の名前で法文物質名を作って結ぶ
 * （コード `INT-IARC-<区分>-CH-<名前の指紋>`）。
 *
 * CHRIP の1件は「その物質（CAS）が、その Agent として、そのグループに評価されている」なので、
 * リンクは (法文物質名, そのページの CAS)。出どころの文章（グループ・Volume・公表年）は
 * リンクの「出典データ」に残す。
 *
 * **刊行済みの巻だけを採る**（2026-09-08 決定）。CHRIP は一覧に出ている最新のグループ
 * （アトラジン 2A、Volume 140 In prep.）で並べているので、グループをまたいで刊行済みの評価
 * （アトラジン 3）の法文物質名へ結ぶ。刊行済みの評価が無いもの（アラクロールなど）は結ばない。
 * 出典データの文章は CHRIP に書いてあるとおり残す。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";
import {
  CAS_SHAPE,
  CATEGORY_OF_GROUP,
  IARC_LAW,
  type OfficialAgent,
  OfficialIndex,
  PendingIndex,
  officialCode,
  readOfficial,
  readOfficialRaw,
} from "./lib/iarc-official";

const prisma = new PrismaClient();

const SOURCE_CODE = "CHRIP";
const DATA_DIR = join(process.cwd(), "scripts/data");

interface Row {
  cas: string;
  group: string;
  agent: string;
  volume: string;
  year: string;
  cid: string;
}

function readRows(): Row[] {
  const text = readFileSync(join(DATA_DIR, "iarc-chrip.tsv"), "utf-8");
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "" || row.startsWith("#")) continue;
    const [cas, group, agent, volume, year, cid] = row.split("\t");
    if (cas && group && agent)
      rows.push({ cas, group, agent, volume: volume ?? "", year: year ?? "", cid: cid ?? "" });
  }
  return rows;
}

/** `Sup 7, 58, 100C` → 番号はいちばん後ろ（CHRIP は古い順に並べている）。`Sup 7` は `Suppl. 7` に寄せる */
function volumeNumber(volume: string): string | null {
  const parts = volume
    .split(/[,、]/)
    .map((v) => v.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  return last.replace(/^Sup\s+/i, "Suppl. ");
}

async function main() {
  const write = process.argv.includes("--write");
  console.log(write ? "書き込みます" : "下見（--write で書き込み）");

  const versionArg = process.argv.slice(2).find((a) => /^\d{4}Q\d$/i.test(a));
  const version = await prisma.linkSetVersion.findFirst({
    where: versionArg
      ? { codeNormalized: versionArg.toUpperCase(), deletedAt: null }
      : { isCurrent: true, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!version)
    throw new Error(
      versionArg ? `バージョン ${versionArg} がありません` : "現在のバージョンが決まっていません",
    );
  const source = await prisma.source.findFirst({
    where: { codeNormalized: SOURCE_CODE, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!source) throw new Error(`データソース ${SOURCE_CODE} がありません`);
  const pair = await prisma.linkVersionSource.findFirst({
    where: { versionId: version.id, sourceId: source.id },
    select: { id: true },
  });
  if (!pair)
    throw new Error(
      `${version.code} に ${source.code} が並んでいません（先に外部データベースの画面で足す）`,
    );
  console.log(`  入れ先: ${version.code} × ${source.code}\n`);

  const law = await prisma.law.findFirst({
    where: { codeNormalized: normalizeCode(IARC_LAW), deletedAt: null },
    select: { id: true },
  });
  if (!law) throw new Error(`法令 ${IARC_LAW} がありません`);

  const master = new Set(
    (
      await prisma.substance.findMany({
        where: { deletedAt: null, casNormalized: { not: null } },
        select: { casNormalized: true },
      })
    ).map((s) => s.casNormalized ?? ""),
  );
  const official = readOfficial();
  const pending = new PendingIndex(readOfficialRaw(), official);

  const rows = readRows();
  console.log(`  CHRIP の評価: ${rows.length} 件`);

  // 法令の法文物質名を全部（刊行準備中の評価は区分をまたいで回すので、法令ぶんまとめて引く）
  const existing = await prisma.statutorySubstance.findMany({
    where: {
      deletedAt: null,
      regulationClass: { deletedAt: null, category: { deletedAt: null, lawId: law.id } },
    },
    select: {
      id: true,
      codeNormalized: true,
      displayOrder: true,
      regulationClass: { select: { id: true, category: { select: { codeNormalized: true } } } },
    },
  });
  const idOf = new Map(existing.map((s) => [s.codeNormalized, s.id]));
  const classOf = new Map<string, string>();
  const nextOrder = new Map<string, number>();
  for (const s of existing) {
    const cat = s.regulationClass.category.codeNormalized;
    classOf.set(cat, s.regulationClass.id);
    nextOrder.set(cat, Math.max(nextOrder.get(cat) ?? 0, s.displayOrder + 1));
  }
  const idOfAgent = (a: OfficialAgent) =>
    idOf.get(normalizeCode(officialCode(CATEGORY_OF_GROUP[a.group] ?? a.group, a.name)));

  const links: {
    statutorySubstanceId: string;
    casNumber: string;
    casNormalized: string;
    text: string;
  }[] = [];
  for (const [group, catCode] of Object.entries(CATEGORY_OF_GROUP)) {
    const mine = rows.filter((r) => r.group === group);
    if (mine.length === 0) continue;

    const classId = classOf.get(normalizeCode(catCode));
    if (!classId) throw new Error(`区分 ${catCode} がありません（先に seed-iarc-laws.ts）`);
    const index = new OfficialIndex(official, group);

    // Agent ごとにまとめる（同じ Agent に複数の CAS が付く）
    const byAgent = new Map<string, Row[]>();
    for (const r of mine) {
      const got = byAgent.get(r.agent) ?? [];
      got.push(r);
      byAgent.set(r.agent, got);
    }

    let matched = 0;
    let created = 0;
    let movedBack = 0;
    let unpublished = 0;
    let notInMaster = 0;
    let count = 0;
    for (const [agent, rs] of byAgent) {
      const usable = rs.filter((r) => CAS_SHAPE.test(r.cas) && master.has(normalizeCas(r.cas)));
      notInMaster += rs.filter(
        (r) => CAS_SHAPE.test(r.cas) && !master.has(normalizeCas(r.cas)),
      ).length;
      if (usable.length === 0) continue;

      const ownCas = usable.length === 1 ? (usable[0]?.cas ?? null) : null;
      const childCas = usable.map((r) => r.cas);

      // 刊行準備中の評価は、刊行済みの評価へ回すか、刊行まで結ばない
      const pend = pending.lookup(agent, ownCas, childCas);
      let hit: OfficialAgent | null;
      if (pend) {
        if (!pend.agent) {
          unpublished += 1;
          continue;
        }
        hit = pend.agent;
        if (hit.group !== group) movedBack += 1;
      } else {
        hit = index.resolve(agent, ownCas, childCas, agent);
      }

      let id: string | undefined;
      if (hit) {
        matched += 1;
        id = idOfAgent(hit);
        if (!id && write)
          throw new Error(
            `正式一覧の法文物質名がありません: ${hit.name}（先に seed-iarc-laws.ts --write）`,
          );
      } else {
        created += 1;
        const code = `${IARC_LAW}-${catCode}-CH-${createHash("sha1").update(agent).digest("hex").slice(0, 10)}`;
        id = idOf.get(normalizeCode(code));
        if (!id && write) {
          const first = usable[0];
          const order = nextOrder.get(normalizeCode(catCode)) ?? 1;
          nextOrder.set(normalizeCode(catCode), order + 1);
          const made = await prisma.statutorySubstance.create({
            data: {
              code,
              codeNormalized: normalizeCode(code),
              classId,
              officialNumber: volumeNumber(first?.volume ?? ""),
              nameOriginal: agent,
              nameLang: "EN",
              nameJa: null,
              nameEn: agent,
              displayOrder: order,
              aggregation: "NONE",
              metalEtc: null,
              thresholdLower: "0",
              lowerBound: "EXCLUSIVE",
              thresholdUpper: "100",
              upperBound: "INCLUSIVE",
              note: first?.volume
                ? `CHRIP の評価対象（IARC の正式一覧に当たらなかったもの）: Volume ${first.volume}${first.year ? `（公表年 ${first.year}）` : ""}`
                : null,
            },
            select: { id: true },
          });
          id = made.id;
          idOf.set(normalizeCode(code), id);
        }
      }
      if (!id) continue;
      for (const r of usable) {
        links.push({
          statutorySubstanceId: id,
          casNumber: r.cas,
          casNormalized: normalizeCas(r.cas),
          text: `発がん性グループ ${r.group}（Volume ${r.volume || "-"}、公表年 ${r.year || "-"}）`,
        });
        count += 1;
      }
    }

    console.log(
      `  ${IARC_LAW}/${catCode}`.padEnd(18) +
        `Agent ${String(byAgent.size).padStart(4)} 種（正式一覧に当たった ${matched} / CHRIP の名前で作る ${created}）` +
        ` / リンク ${String(count).padStart(5)} 件` +
        (movedBack ? ` / 刊行済みの評価へ回した ${movedBack} 種` : "") +
        (unpublished ? ` / 刊行前なので結ばない ${unpublished} 種` : "") +
        (notInMaster ? ` / マスタに無い CAS ${notInMaster} 件` : ""),
    );
  }

  const seen = new Set<string>();
  const fresh = links.filter((l) => {
    const k = `${l.statutorySubstanceId}/${l.casNormalized}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (write) {
    // 法令ぶんの CHRIP のリンクを入れ替える（LOLI のリンクには触らない）
    const ids = [...idOf.values()];
    const old = await prisma.statutoryCasLink.findMany({
      where: { versionId: version.id, sourceId: source.id, statutorySubstanceId: { in: ids } },
      select: { id: true },
    });
    if (old.length) {
      await prisma.statutoryCasLinkData.deleteMany({
        where: { linkId: { in: old.map((o) => o.id) } },
      });
      await prisma.statutoryCasLink.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
    for (let i = 0; i < fresh.length; i += 2000) {
      const chunk = fresh.slice(i, i + 2000);
      await prisma.statutoryCasLink.createMany({
        data: chunk.map((l) => ({
          statutorySubstanceId: l.statutorySubstanceId,
          casNumber: l.casNumber,
          casNormalized: l.casNormalized,
          versionId: version.id,
          sourceId: source.id,
        })),
        skipDuplicates: true,
      });
      const made = await prisma.statutoryCasLink.findMany({
        where: {
          versionId: version.id,
          sourceId: source.id,
          statutorySubstanceId: { in: chunk.map((l) => l.statutorySubstanceId) },
          casNormalized: { in: chunk.map((l) => l.casNormalized) },
        },
        select: { id: true, statutorySubstanceId: true, casNormalized: true },
      });
      const linkIdOf = new Map(
        made.map((m) => [`${m.statutorySubstanceId}/${m.casNormalized}`, m.id]),
      );
      await prisma.statutoryCasLinkData.createMany({
        data: chunk.flatMap((l) => {
          const linkId = linkIdOf.get(`${l.statutorySubstanceId}/${l.casNormalized}`);
          return linkId ? [{ linkId, text: l.text, textJa: null }] : [];
        }),
        skipDuplicates: true,
      });
    }
  }
  console.log(`\n  ${write ? "入れました" : "入れる予定"}：合計 ${fresh.length} 件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
