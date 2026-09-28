import { createHash, randomUUID } from "node:crypto";
import { casCheckDigitOk, looksLikeCas, normalizeCas } from "@chem/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { EntrySourceCode } from "./import-service";

/**
 * 結び付きだけを配るデータ種（LOLI）の取り込み（S23 §9-4）。
 *
 * LOLI の GHS 複合一覧は「CAS → 原典の項目の識別子（refno）」を持ち、原典に無い CAS も
 * 「As 〈親〉」の印付きで親の項目に結んでいる。ここではその結び付きを **識別子に対して** 取り込む
 * （sds_ghs_key_links）。分類の中身は持ち込まない（中身は常に原典）。
 *
 * - 原典の項目に既に載っている CAS は取り込まない（原典の層と区別するため）
 * - 親の識別子が原典に無い行は要確認（UNKNOWN_KEY）に残す
 * - LOLI は正しい前提で使う（2026-09-28 決定）。候補扱いにせず、そのまま採用の対象にする
 * - 丸ごと配布として扱い、前回の結び付きに無いものは足し、今回の一覧に無いものは消す
 */

export const LINK_SOURCE_CODE = "LOLI";

export interface LinkRow {
  targetSource: EntrySourceCode;
  casNormalized: string;
  casRaw: string;
  key: string;
  note: string | null;
}

export interface ParsedLinks {
  rows: LinkRow[];
  /** 読み飛ばした行: RR-（LOLI の擬似 CAS）・UN/NA 番号などの CAS でない識別子、形の合わない CAS */
  skippedPseudo: number;
  skippedInvalid: number;
  issues: string[];
}

const TARGETS = new Set<string>(["NITE", "EU_ANNEX_VI"]);

/** remark の「As 〈親〉 [鍵]」の部分だけを抜く。無ければ remark そのもの */
function noteOf(remark: string): string | null {
  const m = remark.match(/As [^|;]*?\[[^\]]*\]/);
  const s = (m ? m[0] : remark).trim();
  return s ? s.slice(0, 300) : null;
}

/** 列: target_source, cas, key, remark（見出し行なし。scripts/loli-dump-ghs-links.sh の出力） */
export function parseLinksTsv(buf: Buffer): ParsedLinks {
  const out: ParsedLinks = { rows: [], skippedPseudo: 0, skippedInvalid: 0, issues: [] };
  const byKey = new Map<string, LinkRow>();
  const lines = buf
    .toString("utf8")
    .replace(new RegExp("^" + String.fromCharCode(0xfeff)), "")
    .split(/\r?\n/);
  let n = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    n += 1;
    const [target = "", cas = "", key = "", remark = ""] = line.split("\t");
    if (!TARGETS.has(target)) {
      if (out.issues.length < 20) out.issues.push(`${n} 行目: 出典 "${target}" は取り込めません`);
      continue;
    }
    const casRaw = cas.trim();
    if (/^(RR-|UN\d|NA\d|PMN|P-)/i.test(casRaw)) {
      out.skippedPseudo += 1;
      continue;
    }
    const casNormalized = normalizeCas(casRaw);
    if (!looksLikeCas(casNormalized) || !casCheckDigitOk(casNormalized)) {
      out.skippedInvalid += 1;
      if (out.issues.length < 20) out.issues.push(`${n} 行目: CAS の形が合いません "${casRaw}"`);
      continue;
    }
    const k = key.trim();
    if (!k) {
      if (out.issues.length < 20) out.issues.push(`${n} 行目: 識別子が空です（${casRaw}）`);
      continue;
    }
    const id = `${target}\u0000${k}\u0000${casNormalized}`;
    const note = noteOf(remark);
    const prev = byKey.get(id);
    if (!prev) {
      byKey.set(id, {
        targetSource: target as EntrySourceCode,
        casNormalized,
        casRaw: casRaw.slice(0, 30),
        key: k.slice(0, 60),
        note,
      });
    } else if (!prev.note?.startsWith("As ") && note?.startsWith("As ")) {
      // 区分ごとの行で remark が違う。「As …」の印がある行の文を残す
      prev.note = note;
    }
  }
  out.rows = [...byKey.values()];
  return out;
}

export interface LinkDiff {
  parsed: number;
  skippedPseudo: number;
  skippedInvalid: number;
  /** 原典の項目に既に載っている CAS（取り込まない） */
  inSource: number;
  added: LinkRow[];
  unchanged: string[];
  removed: { id: string; key: string; casRaw: string }[];
  /** 親の識別子が原典に無い（要確認） */
  unknownKey: LinkRow[];
  issues: string[];
}

/** いまの結び付きと突き合わせる。DB は読むだけ */
export async function previewLinkImport(parsed: ParsedLinks): Promise<LinkDiff> {
  const diff: LinkDiff = {
    parsed: parsed.rows.length,
    skippedPseudo: parsed.skippedPseudo,
    skippedInvalid: parsed.skippedInvalid,
    inSource: 0,
    added: [],
    unchanged: [],
    removed: [],
    unknownKey: [],
    issues: [...parsed.issues],
  };
  const targets = [...new Set(parsed.rows.map((r) => r.targetSource))];
  for (const code of targets) {
    const source = await prisma.sdsGhsSource.findUnique({ where: { code }, select: { id: true } });
    const rows = parsed.rows.filter((r) => r.targetSource === code);
    if (!source) {
      diff.issues.push(`${code}: 出典がまだ取り込まれていません（${rows.length} 行）`);
      continue;
    }
    // 原典の識別子と、識別子ごとの原典の CAS（版を問わず）
    const entries = await prisma.sdsGhsEntry.findMany({
      where: { sourceId: source.id },
      select: { sourceKey: true, cas: { select: { casNormalized: true } } },
    });
    const keys = new Set<string>();
    const sourceCas = new Set<string>();
    for (const e of entries) {
      keys.add(e.sourceKey);
      for (const c of e.cas) sourceCas.add(`${e.sourceKey}\u0000${c.casNormalized}`);
    }
    const existing = await prisma.sdsGhsKeyLink.findMany({
      where: { sourceId: source.id, linkedBy: LINK_SOURCE_CODE },
      select: { id: true, sourceKey: true, casNormalized: true, casRaw: true },
    });
    const existingBy = new Map(existing.map((l) => [`${l.sourceKey}\u0000${l.casNormalized}`, l]));
    const seen = new Set<string>();
    for (const r of rows) {
      if (!keys.has(r.key)) {
        diff.unknownKey.push(r);
        continue;
      }
      const id = `${r.key}\u0000${r.casNormalized}`;
      if (sourceCas.has(id)) {
        diff.inSource += 1;
        continue;
      }
      seen.add(id);
      const prev = existingBy.get(id);
      if (prev) diff.unchanged.push(prev.id);
      else diff.added.push(r);
    }
    for (const [id, l] of existingBy) {
      if (!seen.has(id)) diff.removed.push({ id: l.id, key: l.sourceKey, casRaw: l.casRaw });
    }
  }
  return diff;
}

export interface LinkImportInput {
  label: string;
  /** YYYY-MM-DD */
  publishedOn: string;
  fileName: string;
  file: Buffer;
}

/** 下見の結果を反映する。公表の記録を LOLI のデータ種に作り、結び付きを足し引きする */
export async function applyLinkImport(
  input: LinkImportInput,
  diff: LinkDiff,
  actorId: string,
): Promise<{ releaseId: string }> {
  const linkSource = await prisma.sdsGhsSource.findUniqueOrThrow({
    where: { code: LINK_SOURCE_CODE },
  });
  const targetIds = new Map<string, string>();
  for (const code of new Set(diff.added.map((r) => r.targetSource))) {
    const s = await prisma.sdsGhsSource.findUniqueOrThrow({
      where: { code },
      select: { id: true },
    });
    targetIds.set(code, s.id);
  }
  const releaseId = randomUUID();
  const linkRows: Prisma.SdsGhsKeyLinkCreateManyInput[] = diff.added.map((r) => ({
    sourceId: targetIds.get(r.targetSource)!,
    sourceKey: r.key,
    casNormalized: r.casNormalized,
    casRaw: r.casRaw,
    origin: "EXPANSION",
    linkedBy: LINK_SOURCE_CODE,
    releaseId,
    note: r.note,
    createdBy: actorId,
  }));
  const issueRows: Prisma.SdsGhsImportIssueCreateManyInput[] = [
    ...diff.issues.map((detail) => ({ releaseId, kind: "PARSE_FAILED" as const, detail })),
    ...diff.unknownKey.map((r) => ({
      releaseId,
      kind: "UNKNOWN_KEY" as const,
      detail: `${r.targetSource} ${r.key} ← ${r.casRaw}: 親の識別子が出典にありません${r.note ? `（${r.note}）` : ""}`,
    })),
  ];
  await prisma.$transaction(
    async (tx) => {
      await tx.sdsGhsRelease.create({
        data: {
          id: releaseId,
          sourceId: linkSource.id,
          label: input.label,
          publishedOn: new Date(`${input.publishedOn}T00:00:00Z`),
          fileName: input.fileName,
          fileSha256: createHash("sha256").update(input.file).digest("hex"),
          importedBy: actorId,
          addedCount: diff.added.length,
          changedCount: 0,
          unchangedCount: diff.unchanged.length,
          closedCount: diff.removed.length,
          issueCount: issueRows.length,
        },
      });
      for (const ids of chunks(
        diff.removed.map((r) => r.id),
        1000,
      )) {
        await tx.sdsGhsKeyLink.deleteMany({ where: { id: { in: ids } } });
      }
      for (const b of chunks(linkRows, 1000)) await tx.sdsGhsKeyLink.createMany({ data: b });
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
