import { jsonError } from "@/lib/authz";
import { prisma } from "@/lib/db";
import type { Messages } from "@chem/shared";

/**
 * 「いつの内容を見て編集を始めたか」の印。
 *
 * **他の人の変更を黙って上書きしないため**に使う。保存は止めない。
 * 画面が開いたときの印を持ち帰り、保存時に添えて送る。
 * サーバーは、いまの印と食い違っていたら**保存せずに知らせる**。
 * 利用者が「このまま保存する」を選べば、印を付け直して保存する。
 *
 * **止めるための仕組みではない。**見てから決めてもらうためのもの。
 * 最後に保存した人が、その内容の責任を負う。
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
export function rowStamp(row: { updatedAt: Date; updatedBy: string | null }): string {
  return String(row.updatedAt.getTime());
}

/** 利用者の表示名。消えていれば null */
export async function nameOf(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, email: true },
  });
  return u?.displayName ?? u?.email ?? null;
}

/**
 * 印が食い違っていたら、409 を返す。合っていれば null。
 *
 * `force` が付いていれば、食い違っていても通す（「このまま保存する」を押したとき）。
 * 印が送られてこないときも通す（古い画面や、外から呼ばれたとき）。
 */
export function staleResponse(
  m: Messages,
  opts: {
    sent: string | undefined;
    now: string;
    force: boolean;
    byName: string | null;
    at: string | null;
  },
): Response | null {
  if (opts.force) return null;
  if (!opts.sent) return null;
  if (opts.sent === opts.now) return null;
  return jsonError(409, "stale_edit", m.errors.staleEdit, {
    byName: opts.byName,
    at: opts.at,
  });
}
