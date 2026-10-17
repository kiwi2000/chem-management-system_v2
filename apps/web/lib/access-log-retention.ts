import { appendFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma } from "@/lib/db";
import { SIGNIN_ACTIONS, TAKEOUT_ACTIONS } from "@/lib/access-log-shared";
import { writeAudit } from "@/lib/audit";
import { ensureWritableDir, resolveOutputDir } from "@/lib/doc-files";
import { getAppSettings } from "@/lib/settings";

/**
 * アクセス記録の古い行の片づけ（2026-10-17 指示）。
 *
 * システム設定「アクセス記録を残す日数」より古い行を、1 日 1 回、裏で片づける。
 * 対象は画面の「アクセス記録」に出る行（ログインと持ち出し）だけ。手で消すとき（admin/access-log の DELETE）と同じ範囲。
 * データの作成・変更の記録（create / update / delete）は残す。
 *
 * 「書き出してから消す」のときは、画面と同じ項目を TSV に書く（UTF-8、BOM つき。表計算ソフトでそのまま開ける）。
 * 利用者はあとで消されることがあるので、名前とメールはこの時点で引いて書く。
 *
 * 走らせるのは lib/maintenance-timer.ts（1 時間おきの見回り）。何度起こされても 1 日 1 回しか走らないように、
 * 走った印は DB（system_settings の行）で持ち、取り合いは updateMany の件数で決める
 * （next dev は共有モジュールを作り直すので、メモリの印は当てにしない）
 */

export const ACCESS_LOG_ACTIONS = [...SIGNIN_ACTIONS, ...TAKEOUT_ACTIONS];

/** 走った印の行（SETTING_DEFS には載せない。サーバーだけが書く） */
export const RETENTION_STATE_KEY = "access_log.retention_state";

/** 1 日 1 回。見回りは 1 時間おきなので、少し短めにして取りこぼさない */
const RUN_INTERVAL_MS = 20 * 60 * 60 * 1000;

/** 1 回に引く行数。大きすぎると長い lock と大きなメモリ、小さすぎると往復が増える */
const CHUNK = 5000;

export interface RetentionState {
  /** 走り始めた時刻 */
  claimedAt: string;
  /** 終わった時刻（走っている最中は無い） */
  finishedAt?: string;
  /** 片づけた件数 */
  count?: number;
  /** 書き出したファイルの名前（書き出したとき） */
  file?: string | null;
  /** 失敗の理由 */
  error?: string | null;
}

/** 片づけの結果（画面に出す） */
export interface RetentionResult {
  skipped: "disabled" | "recent" | null;
  count: number;
  file: string | null;
}

/** ファイル名: access-log_<最初の日>_<最後の日>_<走った時刻>.tsv */
export const ARCHIVE_FILE_PATTERN =
  /^access-log_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_\d{8}T\d{6}\.tsv$/;

export function archiveFileName(from: Date, to: Date, ranAt: Date): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const stamp = ranAt.toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `access-log_${day(from)}_${day(to)}_${stamp}.tsv`;
}

/** TSV の 1 マス。タブ・改行は空白にする（マスを壊さない） */
export function tsvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.replace(/[\t\r\n]+/g, " ");
}

export const ARCHIVE_COLUMNS = [
  "at",
  "action",
  "actor_email",
  "actor_name",
  "target_id",
  "ip",
  "reason",
  "line_count",
  "expanded",
  "user_agent",
  "detail",
] as const;

interface ArchiveRow {
  at: Date;
  action: string;
  actorId: string | null;
  entityId: string | null;
  diff: unknown;
}

/** 1 行を TSV にする。利用者の名前は引いた表から */
export function archiveLine(
  r: ArchiveRow,
  userOf: Map<string, { email: string; displayName: string | null }>,
): string {
  const d = (r.diff ?? {}) as Record<string, unknown>;
  const u = r.actorId ? userOf.get(r.actorId) : undefined;
  return [
    r.at.toISOString(),
    r.action,
    u?.email ?? (typeof d.email === "string" ? d.email : ""),
    u?.displayName ?? "",
    r.entityId,
    d.ip,
    d.reason,
    d.lineCount,
    d.expanded,
    d.userAgent,
    r.diff,
  ]
    .map(tsvCell)
    .join("\t");
}

export function archiveDir(setting: string): string {
  return resolveOutputDir(setting);
}

/** 片づけの状態を読む（画面に出す） */
export async function readRetentionState(): Promise<RetentionState | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: RETENTION_STATE_KEY } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as RetentionState;
  } catch {
    return null;
  }
}

/**
 * 今日の分をこの実行が引き受ける。引き受けられたら true。
 * 前回から 20 時間経っていないか、ほかの実行が先に引き受けていれば false
 */
async function claimRun(now: Date): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: RETENTION_STATE_KEY } });
  const next: RetentionState = { claimedAt: now.toISOString() };
  if (!row) {
    try {
      await prisma.systemSetting.create({
        data: { key: RETENTION_STATE_KEY, valueType: "JSON", value: JSON.stringify(next) },
      });
      return true;
    } catch {
      return false;
    }
  }
  const prev = (() => {
    try {
      return row.value ? (JSON.parse(row.value) as RetentionState) : null;
    } catch {
      return null;
    }
  })();
  const last = prev ? new Date(prev.finishedAt ?? prev.claimedAt) : null;
  if (last && now.getTime() - last.getTime() < RUN_INTERVAL_MS) return false;
  // 同時に起こされた別の実行と取り合う。更新できた 1 つだけが走る
  const r = await prisma.systemSetting.updateMany({
    where: { key: RETENTION_STATE_KEY, updatedAt: row.updatedAt },
    data: { value: JSON.stringify(next) },
  });
  return r.count === 1;
}

async function finishRun(state: RetentionState): Promise<void> {
  await prisma.systemSetting.update({
    where: { key: RETENTION_STATE_KEY },
    data: { value: JSON.stringify(state) },
  });
}

/** 片づける。設定が 0 なら何もしない。前回から 20 時間経っていなければ何もしない */
export async function runAccessLogRetention(now = new Date()): Promise<RetentionResult> {
  const settings = await getAppSettings();
  const days = settings.accessLogRetentionDays;
  if (days <= 0) return { skipped: "disabled", count: 0, file: null };
  if (!(await claimRun(now))) return { skipped: "recent", count: 0, file: null };
  const state: RetentionState = { claimedAt: now.toISOString() };
  try {
    const cutoff = new Date(now.getTime() - days * 86400_000);
    const archive = settings.accessLogRetentionMode === "archive";
    const dir = archive ? archiveDir(settings.accessLogArchiveDir) : null;
    if (dir) await ensureWritableDir(dir);
    // 書きかけは仮の名前。終わったら期間を入れた名前に変える
    const tmp = dir ? join(dir, `.writing-${now.getTime()}.tsv`) : null;
    let first: Date | null = null;
    let last: Date | null = null;
    let count = 0;
    if (tmp) await writeFile(tmp, "﻿" + ARCHIVE_COLUMNS.join("\t") + "\n");

    for (;;) {
      const rows = await prisma.auditLog.findMany({
        where: { action: { in: ACCESS_LOG_ACTIONS }, at: { lt: cutoff } },
        orderBy: { at: "asc" },
        take: CHUNK,
        select: { id: true, at: true, action: true, actorId: true, entityId: true, diff: true },
      });
      if (rows.length === 0) break;
      if (tmp) {
        const actorIds = [...new Set(rows.map((r) => r.actorId).filter((v) => v !== null))];
        const users = await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true, displayName: true },
        });
        const userOf = new Map(users.map((u) => [u.id, u]));
        await appendFile(tmp, rows.map((r) => archiveLine(r, userOf) + "\n").join(""));
      }
      first ??= rows[0]!.at;
      last = rows[rows.length - 1]!.at;
      await prisma.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      count += rows.length;
    }

    let file: string | null = null;
    if (tmp && dir) {
      if (count > 0 && first && last) {
        file = archiveFileName(first, last, now);
        await rename(tmp, join(dir, file));
      } else {
        // 何も無ければファイルは残さない
        await rm(tmp, { force: true });
      }
    }

    // 消した記録そのものは戻らないので、消した事実だけは必ず残す（手で消したときと同じ形）
    if (count > 0) {
      await writeAudit({
        entity: "audit_logs",
        action: "delete",
        diff: { what: `自動（${days} 日より前）`, count, file },
      });
    }
    state.finishedAt = new Date().toISOString();
    state.count = count;
    state.file = file;
    state.error = null;
    await finishRun(state);
    return { skipped: null, count, file };
  } catch (err) {
    state.finishedAt = new Date().toISOString();
    state.error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await finishRun(state).catch(() => undefined);
    throw err;
  }
}

export interface ArchiveFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

/** 書き出したファイルの一覧（新しいものから） */
export async function listArchiveFiles(): Promise<ArchiveFileInfo[]> {
  const settings = await getAppSettings();
  const dir = archiveDir(settings.accessLogArchiveDir);
  await mkdir(dir, { recursive: true }).catch(() => undefined);
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: ArchiveFileInfo[] = [];
  for (const name of names) {
    if (!ARCHIVE_FILE_PATTERN.test(name)) continue;
    const st = await stat(join(dir, name)).catch(() => null);
    if (!st) continue;
    out.push({ name, size: st.size, modifiedAt: st.mtime.toISOString() });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

/** 名前が決まりどおりで、書き出し先の中にあるファイルの道筋。違えば null */
export async function archiveFilePath(name: string): Promise<string | null> {
  if (!ARCHIVE_FILE_PATTERN.test(name)) return null;
  const settings = await getAppSettings();
  const dir = archiveDir(settings.accessLogArchiveDir);
  const p = resolve(dir, name);
  if (!p.startsWith(resolve(dir))) return null;
  const st = await stat(p).catch(() => null);
  return st?.isFile() ? p : null;
}
