/**
 * CHRIP から取った IARC の発がん性評価を、CAS リンクとして入れる（データソース CHRIP）。
 *
 *   python scripts/chrip-iarc-extract.py                              先に抜き出す
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs --tsconfig apps/web/tsconfig.json \
 *     scripts/seed-iarc-chrip-links.ts 2026Q3 --write
 *
 * **CHRIP は LOLI を見ずに作る**（データソースは単独で成り立たせる）。
 * ただし法文物質名（IARC の評価対象）は法律の中身なので共通。CHRIP の Agent名称 を
 * 同じグループの法文物質名に英語名で当て、無ければ CHRIP のぶんとして新しく作る
 * （コード `INT-IARC-<区分>-CH-<名前の指紋>`）。
 *
 * CHRIP の1件は「その物質（CAS）が、その Agent として、そのグループに評価されている」なので、
 * リンクは (法文物質名, そのページの CAS)。出どころの文章（グループ・Volume・公表年）は
 * リンクの「出典データ」に残す。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCas, normalizeCode } from "@chem/shared";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LAW = "INT-IARC";
const SOURCE_CODE = "CHRIP";
const CAS_SHAPE = /^\d{2,7}-\d{2}-\d$/;
const DATA_DIR = join(process.cwd(), "scripts/data");

/** CHRIP のグループ → 区分コード */
const CATEGORY_OF: Record<string, string> = { "1": "G1", "2A": "G2A", "2B": "G2B", "3": "G3" };

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

/** 英語名の突き合わせ用（seed-iarc-laws.ts と同じ寄せかた） */
function nameKey(en: string): string {
  return en
    .toLowerCase()
    .replace(/\[/g, "(")
    .replace(/\]/g, ")")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/[.,;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Wikipedia 由来の日本語名（英語名 → 日本語名）。無ければ空 */
function readNamesJa(): Map<string, string> {
  const map = new Map<string, string>();
  let text = "";
  try {
    text = readFileSync(join(DATA_DIR, "iarc-names-ja.tsv"), "utf-8");
  } catch {
    return map;
  }
  for (const line of text.split("\n")) {
    const row = line.replace(/\r$/, "");
    if (row === "" || row.startsWith("#")) continue;
    const [en, ja] = row.split("\t");
    if (en && ja && !map.has(nameKey(en))) map.set(nameKey(en), ja);
  }
  return map;
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
    where: { codeNormalized: normalizeCode(LAW), deletedAt: null },
    select: { id: true },
  });
  if (!law) throw new Error(`法令 ${LAW} がありません`);

  const master = new Set(
    (
      await prisma.substance.findMany({
        where: { deletedAt: null, casNormalized: { not: null } },
        select: { casNormalized: true },
      })
    ).map((s) => s.casNormalized ?? ""),
  );
  const masterJa = new Map<string, string>();
  for (const s of await prisma.substance.findMany({
    where: { deletedAt: null, isCasRepresentative: true, casNormalized: { not: null } },
    select: { casNormalized: true, nameJa: true },
  })) {
    if (s.casNormalized && s.nameJa && s.nameJa !== s.casNormalized)
      masterJa.set(s.casNormalized, s.nameJa);
  }
  const namesJa = readNamesJa();

  const rows = readRows();
  console.log(`  CHRIP の評価: ${rows.length} 件`);

  let total = 0;
  for (const [group, catCode] of Object.entries(CATEGORY_OF)) {
    const mine = rows.filter((r) => r.group === group);
    if (mine.length === 0) continue;

    const category = await prisma.regulationCategory.findFirst({
      where: { lawId: law.id, codeNormalized: normalizeCode(catCode), deletedAt: null },
      select: { id: true },
    });
    if (!category) throw new Error(`区分 ${catCode} がありません（先に seed-iarc-laws.ts）`);
    const cls = await prisma.regulationClass.findFirst({
      where: { categoryId: category.id, deletedAt: null },
      select: { id: true },
    });
    if (!cls) throw new Error(`区分 ${catCode} に受け皿がありません`);

    const existing = await prisma.statutorySubstance.findMany({
      where: { classId: cls.id, deletedAt: null },
      select: { id: true, nameOriginal: true, displayOrder: true },
    });
    const idByName = new Map(existing.map((s) => [nameKey(s.nameOriginal), s.id]));
    let nextOrder = existing.reduce((m, s) => Math.max(m, s.displayOrder), 0) + 1;

    // Agent ごとにまとめる（同じ Agent に複数の CAS が付く）
    const byAgent = new Map<string, Row[]>();
    for (const r of mine) {
      const got = byAgent.get(r.agent) ?? [];
      got.push(r);
      byAgent.set(r.agent, got);
    }

    let matched = 0;
    let created = 0;
    let notInMaster = 0;
    const links: {
      statutorySubstanceId: string;
      casNumber: string;
      casNormalized: string;
      text: string;
    }[] = [];
    for (const [agent, rs] of byAgent) {
      let id = idByName.get(nameKey(agent)) ?? null;
      if (id) matched += 1;
      else {
        created += 1;
        if (write) {
          const code = `${LAW}-${catCode}-CH-${createHash("sha1").update(agent).digest("hex").slice(0, 10)}`;
          const first = rs[0];
          const nameJa =
            namesJa.get(nameKey(agent)) ??
            (rs.length === 1 && first && CAS_SHAPE.test(first.cas)
              ? (masterJa.get(normalizeCas(first.cas)) ?? null)
              : null);
          const found = await prisma.statutorySubstance.findFirst({
            where: { classId: cls.id, codeNormalized: normalizeCode(code) },
            select: { id: true },
          });
          const payload = {
            officialNumber: volumeNumber(first?.volume ?? ""),
            nameOriginal: agent,
            nameLang: "EN",
            nameJa,
            nameEn: agent,
            aggregation: "NONE" as const,
            metalEtc: null,
            thresholdLower: "0",
            lowerBound: "EXCLUSIVE" as const,
            thresholdUpper: "100",
            upperBound: "INCLUSIVE" as const,
            note: first?.volume
              ? `IARC モノグラフ: ${first.volume}${first.year ? `（公表年 ${first.year}）` : ""}（CHRIP より）`
              : null,
          };
          if (found) {
            await prisma.statutorySubstance.update({ where: { id: found.id }, data: payload });
            id = found.id;
          } else {
            const made = await prisma.statutorySubstance.create({
              data: {
                ...payload,
                code,
                codeNormalized: normalizeCode(code),
                classId: cls.id,
                displayOrder: nextOrder++,
              },
              select: { id: true },
            });
            id = made.id;
          }
          idByName.set(nameKey(agent), id);
        }
      }
      for (const r of rs) {
        if (!CAS_SHAPE.test(r.cas)) continue;
        const casNormalized = normalizeCas(r.cas);
        if (!master.has(casNormalized)) {
          notInMaster += 1;
          continue;
        }
        if (!id) continue;
        links.push({
          statutorySubstanceId: id,
          casNumber: r.cas,
          casNormalized,
          text: `発がん性グループ ${r.group}（Volume ${r.volume || "-"}、公表年 ${r.year || "-"}）`,
        });
      }
    }

    if (write) {
      // この区分ぶんの CHRIP のリンクを入れ替える（LOLI のリンクには触らない）
      const ids = [...idByName.values()];
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
      const seen = new Set<string>();
      const fresh = links.filter((l) => {
        const k = `${l.statutorySubstanceId}/${l.casNormalized}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
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
        const idOf = new Map(
          made.map((m) => [`${m.statutorySubstanceId}/${m.casNormalized}`, m.id]),
        );
        await prisma.statutoryCasLinkData.createMany({
          data: chunk.flatMap((l) => {
            const linkId = idOf.get(`${l.statutorySubstanceId}/${l.casNormalized}`);
            return linkId ? [{ linkId, text: l.text, textJa: null }] : [];
          }),
          skipDuplicates: true,
        });
      }
    }
    total += links.length;
    console.log(
      `  ${LAW}/${catCode}`.padEnd(18) +
        `Agent ${String(byAgent.size).padStart(4)} 種（既存の法文物質名に当たった ${matched} / CHRIP から作る ${created}）` +
        ` / リンク ${String(links.length).padStart(5)} 件` +
        (notInMaster ? ` / マスタに無い CAS ${notInMaster} 件` : ""),
    );
  }
  console.log(`\n  ${write ? "入れました" : "入れる予定"}：合計 ${total} 件`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
