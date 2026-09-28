import type { SdsGhsCasOrigin, SdsGhsClassStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { GHS_CATALOG, categoryRank } from "./catalog-data";
import { SOURCES, SOURCE_OPTIONS } from "./import-service";

/**
 * 国ごとの出典の採用（S23 §5-3）。**単位は物質 × 危険有害性クラス。**
 *
 * 1. 物質ごとの上書き（自社判定）があれば、そのクラスはそれで確定
 * 2. 国の採用順に出典を見て、そのクラスを**評価している**最初の出典を採る
 *    （該当・該当しない・対象外は評価済み。「分類できない」は規則で「次で埋める」なら次へ）
 * 3. どの出典にも無ければ「データなし」
 *
 * 主の出典の評価は下位で上書きしない（下位で埋めるのは主が見ていない項目だけ）。
 *
 * 出典の中で物質（CAS）に当たる項目が複数あるときの決めかた（§9-4、2026-09-28）:
 * - 原典に直接載っている結び付き（SOURCE）を、ほかの層（LOLI の展開・人の手）より先に見る。
 *   総称項目の「別掲のものを除く」は、この順で実装している
 * - それでも項目が複数残る（1 つの CAS が複数の総称に当たる）ときは、クラスごとに**厳しいほうの区分**を採る
 * - どの層を使うかは呼び出し側が選ぶ（画面の切り替え・SDS の設定）。原典の層は常に使う
 *
 * 版・ブロックの読み替えは段 1 の後半で足す（いまは出典の区分をそのまま）
 */

export interface AdoptionRule {
  sourceCode: string;
  priority: number;
  fillCannotClassify: boolean;
}

/** 国の採用順。設定が無ければ既定（その国の出典を先頭に、あとは出典の並び順） */
export async function rulesFor(country: string): Promise<AdoptionRule[]> {
  const rows = await prisma.sdsGhsAdoptionRule.findMany({
    where: { country },
    orderBy: { priority: "asc" },
  });
  if (rows.length > 0) return rows;
  return defaultRules(country);
}

/** 項目を配る出典だけ（結び付きだけのデータ種は採用順に並べない） */
const ENTRY_SOURCES = SOURCES.filter((s) => SOURCE_OPTIONS[s.code].kind === "entries");

export function defaultRules(country: string): AdoptionRule[] {
  const own = ENTRY_SOURCES.filter((s) => s.country === country);
  const rest = ENTRY_SOURCES.filter((s) => s.country !== country).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  return [...own, ...rest].map((s, i) => ({
    sourceCode: s.code,
    priority: i + 1,
    fillCannotClassify: false,
  }));
}

/** どこから来た結び付きか: 原典の CAS か、結び付きの層（LOLI など）か */
export interface LinkVia {
  origin: SdsGhsCasOrigin;
  /** 結び付きの層のコード（"LOLI" / "USER"）。原典なら null */
  linkedBy: string | null;
  /** 当てた項目の識別子（総称項目なら親の識別子）と名前 */
  entryKey: string;
  entryName: string;
  note: string | null;
}

export interface AdoptedCell {
  hazardClass: string;
  status: SdsGhsClassStatus;
  /** 該当のときの区分（複数あり得る）。区分ごとに標的臓器・H を添える */
  items: { category: string; targetOrgans: string | null; hCodes: string | null }[];
  /** どこから来たか: 上書き（OVERRIDE）か出典のコード。データなしなら null */
  from: string | null;
  /** 出典のときの結び付きの来かた（原典 or 結び付きの層） */
  via: LinkVia | null;
  /** 上書きの理由（上書きのときだけ） */
  reason?: string;
}

export interface SourceRow {
  sourceCode: string;
  /** 項目（識別子＋枝番）。同じ出典で複数の項目が当たるときの区別に使う */
  entryKey: string;
  entryName: string;
  hazardClass: string;
  category: string;
  status: SdsGhsClassStatus;
  targetOrgans: string | null;
  hCodes: string | null;
  /** この項目にどう結び付いたか */
  linkOrigin: SdsGhsCasOrigin;
  linkedBy: string | null;
  linkNote: string | null;
}

interface OverrideRow {
  hazardClass: string;
  category: string;
  status: SdsGhsClassStatus;
  targetOrgans: string | null;
  hCodes: string | null;
  country: string;
  reason: string;
}

/** 状態の厳しさ（小さいほど厳しい）。該当 > 該当しない > 分類できない > 対象外 */
const STATUS_RANK: Record<SdsGhsClassStatus, number> = {
  CLASSIFIED: 0,
  NOT_CLASSIFIED: 1,
  CANNOT_CLASSIFY: 2,
  NOT_APPLICABLE: 3,
  NOT_EVALUATED: 4,
};

/**
 * 1 つの出典の、1 つのクラスぶんの行から採用する 1 件を決める。
 * 原典の結び付きの項目を先に見て、その中で厳しいほうの区分（複数区分ならその項目の全部）
 */
function pickWithinSource(rows: SourceRow[]): {
  status: SdsGhsClassStatus;
  items: AdoptedCell["items"];
  via: LinkVia;
} | null {
  if (rows.length === 0) return null;
  const direct = rows.filter((r) => r.linkOrigin === "SOURCE");
  const pool = direct.length > 0 ? direct : rows;
  // 項目ごとにまとめる
  const byEntry = new Map<string, SourceRow[]>();
  for (const r of pool) {
    let list = byEntry.get(r.entryKey);
    if (!list) byEntry.set(r.entryKey, (list = []));
    list.push(r);
  }
  let best: { status: SdsGhsClassStatus; rows: SourceRow[]; rank: number } | null = null;
  for (const list of byEntry.values()) {
    const classified = list.filter((r) => r.status === "CLASSIFIED");
    const status: SdsGhsClassStatus = classified.length > 0 ? "CLASSIFIED" : list[0]!.status;
    const rank =
      status === "CLASSIFIED"
        ? Math.min(...classified.map((r) => categoryRank(r.hazardClass, r.category)))
        : 1000 + STATUS_RANK[status];
    if (!best || rank < best.rank)
      best = { status, rows: classified.length > 0 ? classified : list, rank };
  }
  const first = best!.rows[0]!;
  return {
    status: best!.status,
    items:
      best!.status === "CLASSIFIED"
        ? best!.rows.map((r) => ({
            category: r.category,
            targetOrgans: r.targetOrgans,
            hCodes: r.hCodes,
          }))
        : [],
    via: {
      origin: first.linkOrigin,
      linkedBy: first.linkedBy,
      entryKey: first.entryKey,
      entryName: first.entryName,
      note: first.linkNote,
    },
  };
}

/** 1 物質ぶんを組み立てる。rows は出典の分類（いま効いている項目のもの）、overrides はその物質の上書き */
export function adoptFor(
  rules: AdoptionRule[],
  rows: SourceRow[],
  overrides: OverrideRow[],
  country: string,
): AdoptedCell[] {
  const out: AdoptedCell[] = [];
  for (const cls of GHS_CATALOG) {
    // 1. 上書き（国指定のものを優先、次に全部の国のもの）
    const ov = overrides.filter(
      (o) => o.hazardClass === cls.code && (o.country === country || o.country === ""),
    );
    const chosenOv = ov.some((o) => o.country === country)
      ? ov.filter((o) => o.country === country)
      : ov;
    if (chosenOv.length > 0) {
      const classified = chosenOv.filter((o) => o.status === "CLASSIFIED");
      out.push({
        hazardClass: cls.code,
        status: classified.length > 0 ? "CLASSIFIED" : chosenOv[0]!.status,
        items: classified.map((o) => ({
          category: o.category,
          targetOrgans: o.targetOrgans,
          hCodes: o.hCodes,
        })),
        from: "OVERRIDE",
        via: null,
        reason: chosenOv[0]!.reason,
      });
      continue;
    }
    // 2. 採用順に出典を見る
    let cell: AdoptedCell | null = null;
    for (const rule of rules) {
      const picked = pickWithinSource(
        rows.filter((r) => r.sourceCode === rule.sourceCode && r.hazardClass === cls.code),
      );
      if (!picked) continue; // その出典はこの項目を見ていない → 次へ
      if (picked.status === "CANNOT_CLASSIFY" && rule.fillCannotClassify) {
        cell ??= {
          hazardClass: cls.code,
          status: picked.status,
          items: [],
          from: rule.sourceCode,
          via: picked.via,
        };
        continue; // 分類できない → 次の出典で埋められれば埋める（埋まらなければこれを残す）
      }
      cell = {
        hazardClass: cls.code,
        status: picked.status,
        items: picked.items,
        from: rule.sourceCode,
        via: picked.via,
      };
      break;
    }
    out.push(
      cell ?? { hazardClass: cls.code, status: "NOT_EVALUATED", items: [], from: null, via: null },
    );
  }
  return out;
}

/** 引くときに使う層。原典は常に使う */
export interface AdoptOptions {
  /** 使う結び付きの層のコード（"LOLI" など）。空なら原典だけ */
  linkLayers: ReadonlySet<string>;
  /** 自社判定を使うか */
  useOverrides: boolean;
}

export const DEFAULT_ADOPT_OPTIONS: AdoptOptions = {
  linkLayers: new Set(["LOLI"]),
  useOverrides: true,
};

const ENTRY_SELECT = {
  id: true,
  sourceKey: true,
  subKey: true,
  name: true,
  source: { select: { code: true } },
  classifications: {
    select: { hazardClass: true, category: true, status: true, targetOrgans: true, hCodes: true },
  },
} as const;

type EntryLite = {
  id: string;
  sourceKey: string;
  subKey: string;
  name: string;
  source: { code: string };
  classifications: {
    hazardClass: string;
    category: string;
    status: SdsGhsClassStatus;
    targetOrgans: string | null;
    hCodes: string | null;
  }[];
};

function rowsOf(
  e: EntryLite,
  link: { origin: SdsGhsCasOrigin; linkedBy: string | null; note: string | null },
): SourceRow[] {
  return e.classifications.map((c) => ({
    sourceCode: e.source.code,
    entryKey: e.sourceKey + e.subKey,
    entryName: e.name,
    hazardClass: c.hazardClass,
    category: c.category,
    status: c.status,
    targetOrgans: c.targetOrgans,
    hCodes: c.hCodes,
    linkOrigin: link.origin,
    linkedBy: link.linkedBy,
    linkNote: link.note,
  }));
}

/**
 * CAS の集合について、いま効いている項目を「原典の結び付き」と「結び付きの層」の両方から集める。
 * 戻りは CAS → 行（出典・項目・結び付きの来かた付き）
 */
export async function sourceRowsForCas(
  casList: string[],
  asOf: string,
  linkLayers: ReadonlySet<string>,
): Promise<Map<string, SourceRow[]>> {
  const out = new Map<string, SourceRow[]>();
  if (casList.length === 0) return out;
  const day = new Date(`${asOf}T00:00:00Z`);
  const effective = {
    effectiveFrom: { lte: day },
    OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
  };
  const push = (cas: string, rows: SourceRow[]) => {
    let list = out.get(cas);
    if (!list) out.set(cas, (list = []));
    list.push(...rows);
  };
  // 1. 原典の CAS
  const links = await prisma.sdsGhsEntryCas.findMany({
    where: { casNormalized: { in: casList }, entry: effective },
    select: { casNormalized: true, entry: { select: ENTRY_SELECT } },
  });
  const seenDirect = new Set<string>();
  for (const l of links) {
    const k = `${l.casNormalized}\u0000${l.entry.id}`;
    if (seenDirect.has(k)) continue;
    seenDirect.add(k);
    push(l.casNormalized, rowsOf(l.entry, { origin: "SOURCE", linkedBy: null, note: null }));
  }
  // 2. 結び付きの層（識別子 → いま効いている項目）
  if (linkLayers.size > 0) {
    const keyLinks = await prisma.sdsGhsKeyLink.findMany({
      where: { casNormalized: { in: casList }, linkedBy: { in: [...linkLayers] } },
      select: {
        casNormalized: true,
        sourceId: true,
        sourceKey: true,
        origin: true,
        linkedBy: true,
        note: true,
      },
    });
    if (keyLinks.length > 0) {
      const entries = await prisma.sdsGhsEntry.findMany({
        where: {
          AND: [
            {
              OR: [...new Set(keyLinks.map((k) => `${k.sourceId}\u0000${k.sourceKey}`))].map(
                (s) => {
                  const [sourceId, sourceKey] = s.split("\u0000") as [string, string];
                  return { sourceId, sourceKey };
                },
              ),
            },
            effective,
          ],
        },
        select: { ...ENTRY_SELECT, sourceId: true },
      });
      const byKey = new Map<string, EntryLite[]>();
      for (const e of entries) {
        const k = `${e.sourceId}\u0000${e.sourceKey}`;
        let list = byKey.get(k);
        if (!list) byKey.set(k, (list = []));
        list.push(e);
      }
      for (const k of keyLinks) {
        for (const e of byKey.get(`${k.sourceId}\u0000${k.sourceKey}`) ?? []) {
          // 同じ項目に原典で既に結ばれていれば、層の結び付きは重ねない
          if (seenDirect.has(`${k.casNormalized}\u0000${e.id}`)) continue;
          push(
            k.casNormalized,
            rowsOf(e, { origin: k.origin, linkedBy: k.linkedBy, note: k.note }),
          );
        }
      }
    }
  }
  return out;
}

/**
 * 複数の物質ぶんをまとめて引く（一覧用）。CAS で出典の項目（いま効いているもの）を集め、
 * 物質 ID で上書きを集めて、物質ごとに組み立てる
 */
export async function adoptForSubstances(
  substances: { id: string; casNormalized: string | null }[],
  country: string,
  asOf: string,
  options: AdoptOptions = DEFAULT_ADOPT_OPTIONS,
): Promise<Map<string, AdoptedCell[]>> {
  const rules = await rulesFor(country);
  const casList = [
    ...new Set(substances.map((s) => s.casNormalized).filter((c): c is string => !!c)),
  ];
  const byCas = await sourceRowsForCas(casList, asOf, options.linkLayers);
  const overrides = options.useOverrides
    ? await prisma.sdsGhsOverride.findMany({
        where: {
          substanceId: { in: substances.map((s) => s.id) },
          OR: [{ country }, { country: "" }],
        },
        select: {
          substanceId: true,
          hazardClass: true,
          category: true,
          status: true,
          targetOrgans: true,
          hCodes: true,
          country: true,
          reason: true,
        },
      })
    : [];
  const out = new Map<string, AdoptedCell[]>();
  for (const s of substances) {
    const rows = s.casNormalized ? (byCas.get(s.casNormalized) ?? []) : [];
    const ov = overrides.filter((o) => o.substanceId === s.id);
    out.set(s.id, adoptFor(rules, rows, ov, country));
  }
  return out;
}
