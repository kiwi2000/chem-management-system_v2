import { detectImportFile, isSnapshotLike, type Snapshot } from "@chem/shared";
import type { ImportAction, ImportKind } from "@prisma/client";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { markDone, markRunning } from "@/lib/import/jobs";
import { readRegulationList } from "@/lib/import/read-regulation-list";
import { stageProducts } from "@/lib/import/stage-products";
import { stageSnapshot } from "@/lib/import/stage-snapshot";
import { stageSubstances } from "@/lib/import/stage-substances";
import type { StageSummary, StagedRow } from "@/lib/import/types";

/**
 * 受け取ったファイルを読み、本体と突き合わせて一時領域（ImportRow）に入れる（決定 0011）。
 * 本体には書かない。**HTTP の応答を待たせず裏で回す**（LOLI の版は数十万行）。
 */

/** アップロード直後に見せる概要（種類・行数）。ここでは本体を読まない */
export async function inspectFile(
  fileName: string,
  bytes: Buffer,
): Promise<
  | { ok: true; kind: ImportKind; rowCount?: number; header?: string[]; text: string }
  | { ok: false; reason: string; missing?: string[] }
> {
  const unpacked = await unpack(fileName, bytes);
  if (!unpacked) return { ok: false, reason: "zip_empty" };
  const d = detectImportFile(unpacked.name, unpacked.text);
  if (!d.ok) return { ok: false, reason: d.reason, missing: d.missing };
  return { ok: true, kind: d.kind, rowCount: d.rowCount, header: d.header, text: unpacked.text };
}

/** zip なら中の .json / .tsv / .csv / .txt を 1 つ取り出す。そうでなければそのまま文字にする */
async function unpack(
  fileName: string,
  bytes: Buffer,
): Promise<{ name: string; text: string } | null> {
  if (/\.zip$/i.test(fileName)) {
    const zip = await JSZip.loadAsync(bytes);
    const entry = Object.values(zip.files).find(
      (f) => !f.dir && /\.(json|tsv|csv|txt)$/i.test(f.name),
    );
    if (!entry) return null;
    return { name: entry.name, text: await entry.async("string") };
  }
  return { name: fileName, text: decode(bytes) };
}

/** UTF-8（BOM 可）。UTF-8 として読めなければ Shift_JIS（Excel の既定の CSV）として読み直す */
function decode(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("shift_jis").decode(bytes);
    } catch {
      return bytes.toString("utf-8");
    }
  }
}

/** 裏で読み取りを始める。すでに走っていれば false */
export function startStage(jobId: string): boolean {
  if (!markRunning(jobId, "stage")) return false;
  void runStage(jobId).finally(() => markDone(jobId));
  return true;
}

async function runStage(jobId: string) {
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!job || !job.fileData) return;
  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "LOADING", progress: 0, error: null },
  });
  await prisma.importRow.deleteMany({ where: { jobId } });
  const counts: StageSummary["counts"] = {};
  const notes: string[] = [];
  let seq = 0;
  let errors = 0;
  const emit = async (rows: StagedRow[]) => {
    await prisma.importRow.createMany({
      data: rows.map((r) => {
        seq += 1;
        const c = (counts[r.kind] ??= {});
        c[r.action] = (c[r.action] ?? 0) + 1;
        if (r.action === "ERROR") errors += 1;
        return {
          jobId,
          seq,
          kind: r.kind,
          keyPath: r.keyPath.slice(0, 400),
          label: r.label.slice(0, 500),
          action: r.action,
          apply: r.apply,
          diff: r.diff === undefined ? undefined : (r.diff as object),
          payload: r.payload as object,
          message: r.message?.slice(0, 500),
        };
      }),
    });
    // 進み具合は行数からは分からない（総数が先に分からない）ので、書いた回数で「動いている」ことだけ示す
    await prisma.importJob.update({
      where: { id: jobId },
      data: { progress: Math.min(95, 5 + Math.floor(seq / 5000)) },
    });
  };
  const errorRow = (line: number, message: string): StagedRow => ({
    kind: "law",
    keyPath: line > 0 ? `line:${line}` : "file",
    label: line > 0 ? `${line} 行目` : "ファイル",
    action: "ERROR",
    apply: false,
    payload: {},
    message,
  });

  try {
    const unpacked = await unpack(job.fileName, Buffer.from(job.fileData));
    if (!unpacked) throw new Error("zip の中に読めるファイルがありません");
    let rowCount = 0;
    if (job.kind === "DATA_SET") {
      const parsed: unknown = JSON.parse(unpacked.text);
      if (!isSnapshotLike(parsed)) throw new Error("データセットの形ではありません");
      const snap = parsed as Snapshot;
      rowCount = snap.laws.reduce(
        (n, l) =>
          n +
          l.categories.reduce(
            (m, c) =>
              m +
              c.classes.reduce(
                (k, x) => k + x.substances.reduce((j, s) => j + 1 + s.links.length, 0),
                0,
              ),
            0,
          ),
        0,
      );
      await stageSnapshot(snap, emit, { notes });
    } else if (job.kind === "REGULATION_LIST") {
      const read = await readRegulationList(unpacked.text);
      rowCount = read.rows;
      notes.push(...read.notes);
      if (read.errors.length > 0) await emit(read.errors.map((e) => errorRow(e.line, e.message)));
      await stageSnapshot(read.snapshot, emit, { notes });
    } else if (job.kind === "PRODUCTS") {
      const r = await stageProducts(unpacked.text);
      rowCount = r.count;
      notes.push(...r.notes);
      if (r.errors.length > 0) await emit(r.errors.map((e) => errorRow(e.line, e.message)));
      for (let i = 0; i < r.rows.length; i += 2000) await emit(r.rows.slice(i, i + 2000));
    } else {
      const r = await stageSubstances(unpacked.text);
      rowCount = r.count;
      notes.push(...r.notes);
      if (r.errors.length > 0) await emit(r.errors.map((e) => errorRow(e.line, e.message)));
      for (let i = 0; i < r.rows.length; i += 2000) await emit(r.rows.slice(i, i + 2000));
    }
    const summary: StageSummary = {
      kind: job.kind,
      fileName: job.fileName,
      rows: rowCount,
      counts,
      errors,
      notes: notes.slice(0, 50),
    };
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "STAGED",
        progress: 100,
        stagedAt: new Date(),
        summary: summary as unknown as object,
      },
    });
  } catch (e) {
    console.error("import stage failed:", jobId, e);
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) },
    });
  }
}

/** 画面の要約の集計に使う（行の種類 × 動き） */
export type CountsByKind = Record<string, Partial<Record<ImportAction, number>>>;
