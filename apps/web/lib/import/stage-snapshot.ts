import {
  normalizeCas,
  normalizeCode,
  type CategorySnap,
  type ClassSnap,
  type LawSnap,
  type Snapshot,
  type SubstanceSnap,
} from "@chem/shared";
import { prisma } from "@/lib/db";
import { diffFields, editedByHuman, type StagedRow } from "@/lib/import/types";

/**
 * 法規制データの写し（Snapshot。当方のデータセットも、利用者の規制リストを読み替えたものも同じ形）を
 * 本体と突き合わせ、一時領域の行にする。**本体には書かない。**
 *
 * 対応づけはコード（決定 0011）。法律 → 区分 → 分類 → 法文物質名は親のコードの道筋で、
 * 結び付きは バージョン × データソース × CAS で見る。
 * 本体にあって値が違う行は UPDATE、前回の取り込みのあとに人が直していれば CONFLICT（既定で反映しない）。
 * 結び付きは件数が多いので、法律ごとにまとめて読み、行は chunk ごとに emit で流す
 */

const LAW_FIELDS = [
  "countryCode",
  "nameOriginal",
  "nameLang",
  "nameJa",
  "nameEn",
  "displayOrder",
  "note",
] as const;
const CATEGORY_FIELDS = [
  "nameOriginal",
  "nameLang",
  "nameJa",
  "nameEn",
  "displayOrder",
  "thresholdLower",
  "lowerBound",
  "thresholdUpper",
  "upperBound",
  "aggregation",
  "metalEtc",
  "thresholdBasis",
  "judged",
  "effectiveFrom",
  "effectiveTo",
  "interactionGroup",
  "rank",
  "score",
  "note",
] as const;
const CLASS_FIELDS = [
  "nameOriginal",
  "nameLang",
  "nameJa",
  "nameEn",
  "displayOrder",
  "interactionGroup",
  "rank",
  "note",
] as const;
const SUBSTANCE_FIELDS = [
  "officialNumber",
  "nameOriginal",
  "nameLang",
  "nameJa",
  "nameEn",
  "displayOrder",
  "thresholdLower",
  "lowerBound",
  "thresholdUpper",
  "upperBound",
  "aggregation",
  "metalEtc",
  "effectiveFrom",
  "effectiveTo",
  "applicableCondition",
  "note",
] as const;
const LINK_FIELDS = ["casNumber", "excluded", "note", "text", "textJa"] as const;

type Emit = (rows: StagedRow[]) => Promise<void>;

const CHUNK = 2000;

function label(v: { nameJa?: string | null; nameOriginal?: string | null; code: string }): string {
  return v.nameJa || v.nameOriginal || v.code;
}

/** 更新の行。人が直していれば CONFLICT */
function updateRow(
  base: Omit<StagedRow, "action" | "apply" | "diff" | "message">,
  diff: ReturnType<typeof diffFields>,
  updatedBy: string | null | undefined,
): StagedRow {
  if (Object.keys(diff).length === 0) return { ...base, action: "UNCHANGED", apply: false };
  if (editedByHuman(updatedBy)) {
    return {
      ...base,
      action: "CONFLICT",
      apply: false,
      diff,
      message: "前回の取り込みのあとに画面で直されています。反映するか決めてください",
    };
  }
  return { ...base, action: "UPDATE", apply: true, diff };
}

export interface StageContext {
  /** 読み取りで気づいたこと（画面の要約に出す） */
  notes: string[];
}

export async function stageSnapshot(snap: Snapshot, emit: Emit, ctx: StageContext): Promise<void> {
  let buffer: StagedRow[] = [];
  const push = async (r: StagedRow) => {
    buffer.push(r);
    if (buffer.length >= CHUNK) {
      await emit(buffer);
      buffer = [];
    }
  };

  // ── データソースとバージョン ──
  const sources = await prisma.source.findMany({
    where: { deletedAt: null },
    select: { codeNormalized: true, code: true },
  });
  const sourceSet = new Set(sources.map((s) => s.codeNormalized));
  for (const s of snap.sources) {
    const code = normalizeCode(s.code);
    await push({
      kind: "source",
      keyPath: `source/${s.code}`,
      label: s.code,
      action: sourceSet.has(code) ? "UNCHANGED" : "ADD",
      apply: !sourceSet.has(code),
      payload: { code: s.code },
    });
    sourceSet.add(code);
  }
  const versions = await prisma.linkSetVersion.findMany({
    where: { deletedAt: null },
    select: { codeNormalized: true, code: true, asOf: true, updatedBy: true },
  });
  const versionMap = new Map(versions.map((v) => [v.codeNormalized, v]));
  for (const v of snap.versions) {
    const code = normalizeCode(v.code);
    const cur = versionMap.get(code);
    const base = {
      kind: "version" as const,
      keyPath: `version/${v.code}`,
      label: v.code,
      payload: { code: v.code, asOf: v.asOf },
    };
    if (!cur) {
      await push({ ...base, action: "ADD", apply: true });
      versionMap.set(code, {
        codeNormalized: code,
        code: v.code,
        asOf: new Date(v.asOf),
        updatedBy: null,
      });
    } else {
      await push(
        updateRow(base, diffFields({ asOf: cur.asOf }, { asOf: v.asOf }, ["asOf"]), cur.updatedBy),
      );
    }
  }

  // ── 法律の木 ──
  const countries = await prisma.country.findMany({
    select: { code: true, codeNormalized: true, nameJa: true, nameEn: true },
  });
  // 国はコード（JPN）のほか、名前（日本 / Japan）と 2 文字のコード（JP）でも当てる（利用者の表は書きかたが揺れる）
  const countryByKey = new Map<string, string>();
  for (const c of countries) {
    countryByKey.set(c.codeNormalized, c.code);
    if (c.nameJa) countryByKey.set(normalizeCode(c.nameJa), c.code);
    if (c.nameEn) countryByKey.set(normalizeCode(c.nameEn), c.code);
    const two = ALPHA2[c.codeNormalized];
    if (two) countryByKey.set(two, c.code);
  }
  const countryList = countries.map((c) => c.code).join(", ");
  const laws = await prisma.law.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      codeNormalized: true,
      nameOriginal: true,
      nameLang: true,
      nameJa: true,
      nameEn: true,
      displayOrder: true,
      note: true,
      updatedBy: true,
      country: { select: { code: true } },
    },
  });
  const lawMap = new Map(laws.map((l) => [l.codeNormalized, l]));

  for (const law of snap.laws) {
    const lawKey = normalizeCode(law.code);
    const cur = lawMap.get(lawKey);
    const base = {
      kind: "law" as const,
      keyPath: law.code,
      label: label(law),
      payload: stripLaw(law),
    };
    const country = countryByKey.get(normalizeCode(law.countryCode));
    if (!country) {
      // 法律が作れなければ配下の区分・物質も入れようが無いので、まとめて読み飛ばす
      await push({
        ...base,
        action: "ERROR",
        apply: false,
        message: `国「${law.countryCode}」がありません（登録されている国: ${countryList}）。この法律の区分・物質は読み飛ばしました`,
      });
      continue;
    }
    law.countryCode = country;
    base.payload = stripLaw(law);
    if (!cur) {
      await push({ ...base, action: "ADD", apply: true });
    } else {
      await push(
        updateRow(
          base,
          diffFields(
            { ...cur, countryCode: cur.country.code },
            law as unknown as Record<string, unknown>,
            LAW_FIELDS,
          ),
          cur.updatedBy,
        ),
      );
    }
    await stageLaw(law, cur?.id ?? null, push, ctx, versionMap, sourceSet);
  }
  if (buffer.length > 0) await emit(buffer);
}

/** 2 文字の国コード → 登録している 3 文字のコード（よく書かれるものだけ） */
const ALPHA2: Record<string, string> = {
  JPN: "JP",
  USA: "US",
  CHN: "CN",
  KOR: "KR",
  TWN: "TW",
  GBR: "GB",
  DEU: "DE",
  FRA: "FR",
  ESP: "ES",
  CAN: "CA",
  AUS: "AU",
  NZL: "NZ",
  BRA: "BR",
  THA: "TH",
  VNM: "VN",
  PHL: "PH",
  TUR: "TR",
};

function stripLaw(l: LawSnap) {
  const { categories: _c, ...rest } = l;
  return rest;
}
function stripCategory(c: CategorySnap) {
  const { classes: _c, ...rest } = c;
  return rest;
}
function stripClass(c: ClassSnap) {
  const { substances: _s, ...rest } = c;
  return rest;
}
function stripSubstance(s: SubstanceSnap) {
  const { links: _l, ...rest } = s;
  return rest;
}

async function stageLaw(
  law: LawSnap,
  lawId: string | null,
  push: (r: StagedRow) => Promise<void>,
  ctx: StageContext,
  versionMap: Map<string, unknown>,
  sourceSet: Set<string>,
) {
  // 本体の区分・分類・法文物質名をまとめて読む（法律ごと）
  const categories = lawId
    ? await prisma.regulationCategory.findMany({
        where: { lawId, deletedAt: null },
        select: {
          id: true,
          codeNormalized: true,
          nameOriginal: true,
          nameLang: true,
          nameJa: true,
          nameEn: true,
          displayOrder: true,
          thresholdLower: true,
          lowerBound: true,
          thresholdUpper: true,
          upperBound: true,
          aggregation: true,
          metalEtc: true,
          thresholdBasis: true,
          judged: true,
          effectiveFrom: true,
          effectiveTo: true,
          interactionGroup: true,
          rank: true,
          score: true,
          note: true,
          updatedBy: true,
          classes: {
            where: { deletedAt: null },
            select: {
              id: true,
              codeNormalized: true,
              nameOriginal: true,
              nameLang: true,
              nameJa: true,
              nameEn: true,
              displayOrder: true,
              interactionGroup: true,
              rank: true,
              note: true,
              updatedBy: true,
              statutorySubstances: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  codeNormalized: true,
                  officialNumber: true,
                  nameOriginal: true,
                  nameLang: true,
                  nameJa: true,
                  nameEn: true,
                  displayOrder: true,
                  thresholdLower: true,
                  lowerBound: true,
                  thresholdUpper: true,
                  upperBound: true,
                  aggregation: true,
                  metalEtc: true,
                  effectiveFrom: true,
                  effectiveTo: true,
                  applicableCondition: true,
                  note: true,
                  updatedBy: true,
                },
              },
            },
          },
        },
      })
    : [];
  const catMap = new Map(categories.map((c) => [c.codeNormalized, c]));

  // 結び付きは法律ごとにまとめて読む（法文物質名の id → 版/ソース/CAS の集合）
  const substanceIds = categories.flatMap((c) =>
    c.classes.flatMap((k) => k.statutorySubstances.map((s) => s.id)),
  );
  const linkMap = new Map<
    string,
    {
      id: string;
      casNumber: string;
      excluded: boolean;
      note: string | null;
      text: string | null;
      textJa: string | null;
      updatedBy: string | null;
    }
  >();
  if (substanceIds.length > 0) {
    // 大きい法律（LOLI 由来で十数万）は id 順に区切って読む
    let cursor: string | null = null;
    for (;;) {
      const page: {
        id: string;
        statutorySubstanceId: string;
        casNumber: string;
        casNormalized: string;
        excluded: boolean;
        note: string | null;
        updatedBy: string | null;
        version: { codeNormalized: string };
        source: { codeNormalized: string };
        data: { text: string; textJa: string | null } | null;
      }[] = await prisma.statutoryCasLink.findMany({
        where: {
          statutorySubstanceId: { in: substanceIds },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 20000,
        select: {
          id: true,
          statutorySubstanceId: true,
          casNumber: true,
          casNormalized: true,
          excluded: true,
          note: true,
          updatedBy: true,
          version: { select: { codeNormalized: true } },
          source: { select: { codeNormalized: true } },
          data: { select: { text: true, textJa: true } },
        },
      });
      for (const l of page) {
        linkMap.set(
          `${l.statutorySubstanceId}|${l.version.codeNormalized}|${l.source.codeNormalized}|${l.casNormalized}`,
          {
            id: l.id,
            casNumber: l.casNumber,
            excluded: l.excluded,
            note: l.note,
            text: l.data?.text ?? null,
            textJa: l.data?.textJa ?? null,
            updatedBy: l.updatedBy,
          },
        );
      }
      if (page.length < 20000) break;
      cursor = page[page.length - 1]!.id;
    }
  }

  for (const cat of law.categories) {
    const catCur = catMap.get(normalizeCode(cat.code));
    const catPath = `${law.code}/${cat.code}`;
    const catBase = {
      kind: "category" as const,
      keyPath: catPath,
      label: label(cat),
      payload: { ...stripCategory(cat), lawCode: law.code },
    };
    if (!catCur) await push({ ...catBase, action: "ADD", apply: true });
    else
      await push(
        updateRow(
          catBase,
          diffFields(catCur, cat as unknown as Record<string, unknown>, CATEGORY_FIELDS),
          catCur.updatedBy,
        ),
      );
    const classMap = new Map((catCur?.classes ?? []).map((k) => [k.codeNormalized, k]));

    for (const cls of cat.classes) {
      const clsCur = classMap.get(normalizeCode(cls.code));
      const clsPath = `${catPath}/${cls.code}`;
      const clsBase = {
        kind: "class" as const,
        keyPath: clsPath,
        label: label(cls),
        payload: { ...stripClass(cls), lawCode: law.code, categoryCode: cat.code },
      };
      if (!clsCur) await push({ ...clsBase, action: "ADD", apply: true });
      else
        await push(
          updateRow(
            clsBase,
            diffFields(clsCur, cls as unknown as Record<string, unknown>, CLASS_FIELDS),
            clsCur.updatedBy,
          ),
        );
      const subMap = new Map((clsCur?.statutorySubstances ?? []).map((s) => [s.codeNormalized, s]));

      for (const sub of cls.substances) {
        const subCur = subMap.get(normalizeCode(sub.code));
        const subPath = `${clsPath}/${sub.code}`;
        const subBase = {
          kind: "substance" as const,
          keyPath: subPath,
          label: label(sub),
          payload: {
            ...stripSubstance(sub),
            lawCode: law.code,
            categoryCode: cat.code,
            classCode: cls.code,
          },
        };
        if (!subCur) await push({ ...subBase, action: "ADD", apply: true });
        else
          await push(
            updateRow(
              subBase,
              diffFields(subCur, sub as unknown as Record<string, unknown>, SUBSTANCE_FIELDS),
              subCur.updatedBy,
            ),
          );

        for (const link of sub.links) {
          const vKey = normalizeCode(link.version);
          const sKey = normalizeCode(link.source);
          const cas = normalizeCas(link.cas);
          const linkPath = `${subPath}/${link.version}/${link.source}/${link.cas}`;
          const linkBase = {
            kind: "link" as const,
            keyPath: linkPath,
            label: `${label(sub)} ${link.cas}`,
            payload: {
              ...link,
              lawCode: law.code,
              categoryCode: cat.code,
              classCode: cls.code,
              substanceCode: sub.code,
            },
          };
          if (!versionMap.has(vKey) || !sourceSet.has(sKey)) {
            await push({
              ...linkBase,
              action: "ERROR",
              apply: false,
              message: `バージョン「${link.version}」かデータソース「${link.source}」がファイルにも本体にもありません`,
            });
            continue;
          }
          const cur = subCur ? linkMap.get(`${subCur.id}|${vKey}|${sKey}|${cas}`) : undefined;
          if (!cur) {
            await push({ ...linkBase, action: "ADD", apply: true });
          } else {
            await push(
              updateRow(
                linkBase,
                diffFields(cur, link as unknown as Record<string, unknown>, LINK_FIELDS),
                cur.updatedBy,
              ),
            );
          }
        }
      }
    }
  }
  void ctx;
}
