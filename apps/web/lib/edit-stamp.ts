import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { Messages } from "@chem/shared";
import { z } from "zod";

/**
 * 「いつの内容を見て編集を始めたか」の印（楽観的ロック）。
 *
 * **他の人の変更を黙って上書きしないため**に使う。
 * 画面が開いたときの印（DTO の `stamp`）を持ち帰り、保存時に添えて送る。
 * サーバーは、いまの印と食い違っていたら**保存せずに 409 で知らせる**（誰が・いつ変えたかを添えて）。
 * 利用者が「このまま保存する」を選べば `force` を付けて送り直し、そのときは通す。
 * 最後に保存した人が、その内容の責任を負う。
 *
 * **編集の API には必ず入れる（2026-10-18 指示）。** 印が送られてこなければ 400 で断る
 * （古い画面や、印を付け忘れた画面を黙って通さない。呼び忘れは lib/edit-stamp-coverage.test.ts が検出する）。
 *
 * 使いかた（1 行の表を直す API）:
 *
 *   const lock = parseEditStamp(body, m);
 *   if (lock instanceof Response) return lock;
 *   const hit = await prisma.law.updateMany({ where: { id, ...stampWhere(lock) }, data });
 *   if (hit.count === 0) return staleFromRow(m, await prisma.law.findUnique({ where: { id }, select: STAMP_SELECT }));
 *
 * 入れ子の書き込み（子の表を作り直すなど）があるときは、対話型のトランザクションの**最初**に
 * `updateMany` の門番を置き、`count === 0` なら `StaleError` を投げて外で `staleFromRow` に変える。
 * 門番は行をロックするので、同時に来た 2 つの保存のうち後の方は必ず食い違いになる（PostgreSQL の READ COMMITTED）。
 *
 * 印は更新時刻（ミリ秒）そのもの。`@updatedAt` は updateMany でも進むので、門番を通った時点で印は新しくなる
 */

/** 画面へ返す印と、誰がいつ更新したか */
export interface EditStamp {
  /** 内容が変わると変わる文字列。中身の意味は問わない */
  stamp: string;
  /** 直前に更新した人の名前。分からなければ null */
  byName: string | null;
  /** 直前に更新した時刻 */
  at: string | null;
}

/** 保存の本文に付いてくる印 */
export interface EditLock {
  stamp: string;
  /** 「このまま保存する」を押したとき。印が食い違っていても通す */
  force: boolean;
}

export const editStampSchema = z.object({
  stamp: z.string().min(1),
  force: z.boolean().optional(),
});

/** 行の印に要る列 */
export const STAMP_SELECT = { updatedAt: true, updatedBy: true } as const;

/**
 * 組成の印。
 *
 * **製品の更新時刻は使えない。**組成を保存すると製品の更新者も動かすため、
 * 組成を触っただけで基本情報の画面まで「変わった」ことになってしまう。
 * 行の数と、行の更新時刻のいちばん新しいものを合わせて印にする
 */
export async function compositionStamp(productId: string): Promise<EditStamp> {
  const rows = await prisma.compositionLine.findMany({
    where: { parentProductId: productId },
    select: { updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 1,
  });
  const count = await prisma.compositionLine.count({ where: { parentProductId: productId } });
  const latest = rows[0]?.updatedAt ?? null;
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { updatedBy: true, updatedAt: true },
  });
  const byName = product?.updatedBy ? await nameOf(product.updatedBy) : null;
  return {
    stamp: `${count}:${latest ? latest.getTime() : 0}`,
    byName,
    at: latest ? latest.toISOString() : null,
  };
}

/** 1行だけの表（製品・物質など）の印。更新時刻をそのまま使う */
export function rowStamp(row: { updatedAt: Date }): string {
  return String(row.updatedAt.getTime());
}

/**
 * 複数の行でひとまとまりの設定（システム設定・ランクの段など）の印。
 * いちばん新しい更新時刻と行数。行が無ければ "0:0"
 */
export function rowsStamp(rows: { updatedAt: Date }[]): string {
  const latest = rows.reduce((a, r) => Math.max(a, r.updatedAt.getTime()), 0);
  return `${rows.length}:${latest}`;
}

/** 利用者の表示名。消えていれば null */
export async function nameOf(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, email: true },
  });
  return u?.displayName ?? u?.email ?? null;
}

/** 本文から印を取り出す。無ければ 400（画面の付け忘れを黙って通さない） */
export function parseEditStamp(body: unknown, m: Messages): EditLock | Response {
  const parsed = editStampSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "stamp_required", m.errors.stampRequired, parsed.error.flatten());
  }
  return { stamp: parsed.data.stamp, force: parsed.data.force === true };
}

/**
 * 1 行の表の門番の条件。`updateMany` の where に広げる。
 * 印が更新時刻のミリ秒なので、その時刻のままの行だけが当たる。force なら条件なし
 */
export function stampWhere(lock: EditLock): { updatedAt?: Date } {
  if (lock.force) return {};
  const ms = Number(lock.stamp);
  // 読めない印は「必ず食い違う」条件にする（何も更新させない）
  return { updatedAt: Number.isFinite(ms) ? new Date(ms) : new Date(0) };
}

/** 入れ子の書き込みの中で食い違いが分かったときに投げる。外で staleFromRow に変える */
export class StaleError extends Error {
  constructor() {
    super("stale_edit");
  }
}

/** 食い違いの 409。いまの行の更新者・時刻を添える */
export async function staleFromRow(
  m: Messages,
  row: { updatedAt: Date; updatedBy?: string | null } | null | undefined,
): Promise<Response> {
  const byName = row?.updatedBy ? await nameOf(row.updatedBy) : null;
  return jsonError(409, "stale_edit", m.errors.staleEdit, {
    byName,
    at: row?.updatedAt ? row.updatedAt.toISOString() : null,
  });
}

/**
 * 印が食い違っていたら 409、合っていれば null（組成のように印を自前で作るもの用）。
 * `force` が付いていれば、食い違っていても通す
 */
export function staleResponse(
  m: Messages,
  opts: {
    sent: string;
    now: string;
    force: boolean;
    byName: string | null;
    at: string | null;
  },
): Response | null {
  if (opts.force) return null;
  if (opts.sent === opts.now) return null;
  return jsonError(409, "stale_edit", m.errors.staleEdit, {
    byName: opts.byName,
    at: opts.at,
  });
}
