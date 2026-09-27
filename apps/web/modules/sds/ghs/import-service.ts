import { createHash, randomUUID } from "node:crypto";
import type { Prisma, SdsGhsClassStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { GHS_CATALOG } from "./catalog-data";
import {
  NITE_COLUMNS,
  contentHashOf,
  readNiteMain,
  readNiteRationale,
  type ParsedEntry,
} from "./nite";

/**
 * GHS 分類データの取り込み（S23 段 0）。
 *
 * 出どころが配った 1 回分（公表）を読み、いま有効な項目と突き合わせて
 * **追加・変更・変わらず・見当たらず** に分け、「取り込む」で反映する。
 *
 * - 変更: 古い項目に適用終了日（公表日の前日）を入れ、新しい項目を足す。古い行は残す（判定対象日で引くため）
 * - 変わらず: 「最後に確認した公表」だけ更新
 * - 見当たらず（丸ごと配布に載らなくなった）: 閉じずに要確認に出す。消えた＝撤回とは限らない
 * - 読めなかったセル: 要確認に残す。取り込みは止めない
 */

/** いま読める出どころ。ほかの国は読み手ができたときに足す */
export const SOURCES = [
  {
    code: "NITE",
    nameJa: "NITE 政府 GHS 分類（統合版）",
    nameEn: "NITE government GHS classification (consolidated)",
    country: "JP",
    provider: "PUBLIC",
    delivery: "FULL",
    legalStatus: "REFERENCE",
    identifierKind: "OWN_ID",
    coversAllClasses: true,
    defaultGhsRevision: null,
    licenseNote:
      "ラベル・SDS 作成時の引用・複写は自由（各ページの記載）。製品への組み込み・再配布は明文なし。https://www.chem-info.nite.go.jp/chem/ghs/",
    sortOrder: 10,
  },
] as const;

export type SourceCode = (typeof SOURCES)[number]["code"];

/** 出どころ・カタログ・辞書の初期データを DB に入れる（何度呼んでもよい） */
export async function ensureSeed(): Promise<void> {
  for (const s of SOURCES) {
    await prisma.sdsGhsSource.upsert({
      where: { code: s.code },
      create: { ...s },
      update: {
        nameJa: s.nameJa,
        nameEn: s.nameEn,
        licenseNote: s.licenseNote,
        sortOrder: s.sortOrder,
      },
    });
  }
  let order = 0;
  for (const c of GHS_CATALOG) {
    order += 10;
    await prisma.sdsGhsHazardCatalog.upsert({
      where: { hazardClass_category: { hazardClass: c.code, category: "" } },
      create: {
        hazardClass: c.code,
        category: "",
        nameJa: c.nameJa,
        nameEn: c.nameEn,
        abbrevEn: c.abbrevEn,
        sortOrder: order,
      },
      update: { nameJa: c.nameJa, nameEn: c.nameEn, abbrevEn: c.abbrevEn, sortOrder: order },
    });
    let sub = 0;
    for (const k of c.categories) {
      sub += 1;
      const data = {
        hCodes: k.hCodes?.join(",") || null,
        abbrevEn: `${c.abbrevEn} ${k.category}`,
        nameJa: k.nameJa ?? `${c.nameJa} 区分${k.category}`,
        nameEn: k.nameEn ?? `${c.nameEn} - category ${k.category}`,
        ghsRevisionFrom: k.from ?? null,
        sortOrder: order + sub,
      };
      await prisma.sdsGhsHazardCatalog.upsert({
        where: { hazardClass_category: { hazardClass: c.code, category: k.category } },
        create: { hazardClass: c.code, category: k.category, ...data },
        update: data,
      });
    }
  }
  // NITE の列名 → クラスコード（辞書に残しておく。人が見て確かめられるように）
  for (const [raw, canonical] of Object.entries(NITE_COLUMNS)) {
    await prisma.sdsGhsTermAlias.upsert({
      where: { sourceCode_kind_raw: { sourceCode: "NITE", kind: "CLASS", raw } },
      create: { sourceCode: "NITE", kind: "CLASS", raw, canonical, note: "統合版の列名" },
      update: { canonical },
    });
  }
}

export interface ImportInput {
  sourceCode: SourceCode;
  label: string;
  /** YYYY-MM-DD */
  publishedOn: string;
  fileName: string;
  main: Buffer;
  rationale?: Buffer;
}

export interface Diff {
  parsed: number;
  added: ParsedEntry[];
  changed: { next: ParsedEntry; prevId: string }[];
  unchanged: string[];
  /** 丸ごと配布に載らなくなった、いま有効な項目 */
  disappeared: { id: string; sourceKey: string; name: string }[];
  /** 読み取りの問題（ファイル全体＋セル） */
  issues: string[];
  fileIssues: string[];
}

/** ファイルを読んで、いまの状態との差分を出す。DB は読むだけ */
export async function previewImport(input: ImportInput): Promise<Diff> {
  const rationale = input.rationale ? await readNiteRationale(input.rationale) : undefined;
  const result = await readNiteMain(input.main, rationale);
  if (result.issues.length > 0) {
    return {
      parsed: 0,
      added: [],
      changed: [],
      unchanged: [],
      disappeared: [],
      issues: [],
      fileIssues: result.issues,
    };
  }
  const source = await prisma.sdsGhsSource.findUniqueOrThrow({ where: { code: input.sourceCode } });
  const open = await prisma.sdsGhsEntry.findMany({
    where: { sourceId: source.id, effectiveTo: null },
    select: { id: true, sourceKey: true, subKey: true, name: true, contentHash: true },
  });
  const openBy = new Map(open.map((e) => [`${e.sourceKey}\u0000${e.subKey}`, e]));
  const seen = new Set<string>();
  const diff: Diff = {
    parsed: result.entries.length,
    added: [],
    changed: [],
    unchanged: [],
    disappeared: [],
    issues: [],
    fileIssues: [],
  };
  for (const e of result.entries) {
    const key = `${e.sourceKey}\u0000${e.subKey}`;
    if (seen.has(key)) {
      diff.issues.push(
        `${e.sourceKey}${e.subKey}: 同じ物質 ID が 2 回出ています（後のものは読み飛ばし）`,
      );
      continue;
    }
    seen.add(key);
    for (const i of e.issues) diff.issues.push(`${e.sourceKey}${e.subKey} ${e.name}: ${i}`);
    const prev = openBy.get(key);
    if (!prev) diff.added.push(e);
    else if (prev.contentHash === contentHashOf(e)) diff.unchanged.push(prev.id);
    else diff.changed.push({ next: e, prevId: prev.id });
  }
  for (const [key, prev] of openBy) {
    if (!seen.has(key))
      diff.disappeared.push({
        id: prev.id,
        sourceKey: prev.sourceKey + prev.subKey,
        name: prev.name,
      });
  }
  return diff;
}

function dayBefore(day: string): Date {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * 下見の結果をそのまま DB に反映する。公表の記録を作り、項目・CAS・分類を足す。
 * 3,500 物質 × 35 クラスで 12 万行になるので、id を先に決めて createMany でまとめて入れる
 */
export async function applyImport(
  input: ImportInput,
  diff: Diff,
  actorId: string,
): Promise<{ releaseId: string }> {
  const source = await prisma.sdsGhsSource.findUniqueOrThrow({ where: { code: input.sourceCode } });
  const publishedOn = new Date(`${input.publishedOn}T00:00:00Z`);
  const sha = createHash("sha256").update(input.main).digest("hex");
  const releaseId = randomUUID();

  const fresh = [...diff.added, ...diff.changed.map((c) => c.next)];
  const entryRows: Prisma.SdsGhsEntryCreateManyInput[] = [];
  const casRows: Prisma.SdsGhsEntryCasCreateManyInput[] = [];
  const classRows: Prisma.SdsGhsClassificationCreateManyInput[] = [];
  for (const e of fresh) {
    const id = randomUUID();
    entryRows.push({
      id,
      sourceId: source.id,
      sourceKey: e.sourceKey,
      subKey: e.subKey,
      name: e.name.slice(0, 500),
      effectiveFrom: publishedOn,
      releaseInId: releaseId,
      releaseLastSeenId: releaseId,
      rawRow: e.rawRow,
      contentHash: contentHashOf(e),
    });
    e.cas.forEach((c, i) =>
      casRows.push({
        entryId: id,
        casNormalized: c.normalized,
        casRaw: c.raw.slice(0, 30),
        ordinal: i + 1,
        origin: "SOURCE",
      }),
    );
    for (const c of e.classifications) {
      classRows.push({
        entryId: id,
        hazardClass: c.hazardClass,
        category: c.category,
        status: c.status as SdsGhsClassStatus,
        targetOrgans: c.targetOrgans?.slice(0, 200) ?? null,
        hCodes: c.hCodes.length ? c.hCodes.join(",") : null,
        hCodesOrigin: c.hCodes.length ? "CATALOG" : null,
        ghsRevision: c.ghsRevision ?? null,
        classifiedIn: c.classifiedIn?.slice(0, 40) ?? null,
        rationale: c.rationale || null,
        rawClassText: c.rawClassText.slice(0, 200),
      });
    }
  }
  const issueRows: Prisma.SdsGhsImportIssueCreateManyInput[] = [
    ...diff.issues.map((detail) => ({ releaseId, kind: "UNKNOWN_TERM" as const, detail })),
    ...diff.disappeared.map((d) => ({
      releaseId,
      entryId: d.id,
      kind: "DISAPPEARED" as const,
      detail: `${d.sourceKey} ${d.name}: この公表に載っていません（前の行はそのまま有効）`,
    })),
  ];

  await prisma.$transaction(
    async (tx) => {
      await tx.sdsGhsRelease.create({
        data: {
          id: releaseId,
          sourceId: source.id,
          label: input.label,
          publishedOn,
          fileName: input.fileName,
          fileSha256: sha,
          importedBy: actorId,
          addedCount: diff.added.length,
          changedCount: diff.changed.length,
          unchangedCount: diff.unchanged.length,
          closedCount: 0,
          issueCount: issueRows.length,
        },
      });
      // 変わらず: 最後に確認した公表だけ更新
      for (const ids of chunks(diff.unchanged, 1000)) {
        await tx.sdsGhsEntry.updateMany({
          where: { id: { in: ids } },
          data: { releaseLastSeenId: releaseId },
        });
      }
      // 変更: 古い項目を閉じる（公表日の前日まで）
      for (const ids of chunks(
        diff.changed.map((c) => c.prevId),
        1000,
      )) {
        await tx.sdsGhsEntry.updateMany({
          where: { id: { in: ids } },
          data: { effectiveTo: dayBefore(input.publishedOn) },
        });
      }
      for (const b of chunks(entryRows, 500)) await tx.sdsGhsEntry.createMany({ data: b });
      for (const b of chunks(casRows, 1000)) await tx.sdsGhsEntryCas.createMany({ data: b });
      for (const b of chunks(classRows, 2000))
        await tx.sdsGhsClassification.createMany({ data: b });
      for (const b of chunks(issueRows, 1000)) await tx.sdsGhsImportIssue.createMany({ data: b });
    },
    { timeout: 10 * 60_000, maxWait: 30_000 },
  );
  return { releaseId };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
