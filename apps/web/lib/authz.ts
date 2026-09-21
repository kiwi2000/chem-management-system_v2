import { canEditAnything, expandPermissions, isPermission, type Permission } from "@chem/shared";
import type { User as AppUser } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerMessages } from "@/lib/i18n";
import { hasPasskey } from "@/lib/passkey";
import { PENDING_PATH, pendingStep } from "@/lib/pending-step";
import { getAppSettings } from "@/lib/settings";

/**
 * 認可ポリシー（単一モジュールに集中: CLAUDE.md §4）。
 * すべての API Route Handler はここを必ず通すこと。クライアント側の制御だけに頼らない。
 *
 * 権限の含意（編集できるなら見られる 等）は保存時に展開済みなので、
 * ここでは集合に入っているかどうかだけを見る。
 */

export interface Actor {
  user: AppUser;
  permissions: Permission[];
  has: (p: Permission) => boolean;
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return Response.json({ error: { code, message, details } }, { status });
}

async function loadPermissions(userId: string): Promise<Permission[]> {
  const rows = await prisma.userPermission.findMany({
    where: { userId },
    select: { permission: true },
  });
  // 含意（製品を編集できる → 組成を見られる、など）は保存時に閉じているが、
  // 直接書き込まれた行でも同じ答えになるよう、読むときにも閉じる。
  // DB の enum にだけ残っている古い値（DOCUMENT_SENDER）は無いものとして扱う
  return expandPermissions(rows.map((r) => r.permission).filter(isPermission));
}

/**
 * ログイン中のユーザーと権限。未ログインなら null。
 * ページ（サーバーコンポーネント）から使う。API からは requireUser を使うこと。
 */
export async function getActor(): Promise<Actor | null> {
  const user = await getSessionUser().catch(() => null);
  if (!user) return null;
  const permissions = await loadPermissions(user.id);
  return { user, permissions, has: (p) => permissions.includes(p) };
}

/**
 * 利用者IDから Actor を組み立てる。**バックグラウンド処理用。**
 * 画面や API の外（まとめて帳票を作る仕事など）で、頼んだ人の権限のまま動くために使う。
 * 消された・止められた利用者なら null
 */
export async function actorOf(userId: string): Promise<Actor | null> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user || !user.activeFlag) return null;
  const permissions = await loadPermissions(user.id);
  return { user, permissions, has: (p) => permissions.includes(p) };
}

/**
 * 認証必須。未認証は 401 Response を返す。
 *
 * **済ませていない用事（初期パスワードの変更・2要素認証の登録）がある人は、
 * ここで止める。**画面側の誘導だけに任せると、URL を直に打てば素通りできてしまう。
 *
 * `allowPending` を渡せるのは、**その用事を済ませるために要るものだけ。**
 * 増やすと、済ませずに使い回せる道ができてしまうので、
 * `authz-coverage.test.ts` が数を見張っている。
 */
export async function requireUser(opts?: { allowPending?: boolean }): Promise<Actor | Response> {
  const actor = await getActor();
  if (!actor) {
    const m = await getServerMessages();
    return jsonError(401, "unauthorized", m.errors.unauthorized);
  }
  if (!opts?.allowPending) {
    const step = pendingStep(
      { ...actor.user, hasPasskey: await hasPasskey(actor.user.id) },
      await getAppSettings(),
    );
    if (step) {
      const m = await getServerMessages();
      // 行き先を添える。画面側はこれを見て、済ませる画面へ送る
      return jsonError(403, "pending_setup", m.errors.pendingSetup, {
        path: PENDING_PATH[step],
      });
    }
  }
  return actor;
}

/** 指定の権限が必要。足りなければ 403 */
export async function requirePermission(p: Permission): Promise<Actor | Response> {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  if (!actor.has(p)) {
    const m = await getServerMessages();
    return jsonError(
      403,
      "forbidden",
      p === "ADMIN" ? m.errors.forbiddenAdmin : m.errors.forbidden,
    );
  }
  return actor;
}

/** 指定のうち少なくとも1つ持っていればよい（画面の入口など） */
export async function requireAnyPermission(...ps: Permission[]): Promise<Actor | Response> {
  const actor = await requireUser();
  if (actor instanceof Response) return actor;
  if (!ps.some((p) => actor.has(p))) {
    const m = await getServerMessages();
    return jsonError(403, "forbidden", m.errors.forbidden);
  }
  return actor;
}

/** システム管理者のみ（ユーザー管理・システム設定・監査ログ） */
export async function requireAdmin(): Promise<Actor | Response> {
  return requirePermission("ADMIN");
}

/** 何かを編集できるか（画面の「参照のみ」表示に使う） */
export function canEdit(actor: Actor): boolean {
  return canEditAnything(actor.permissions);
}

/*
  ── PRTR の担当の範囲（S22）──────────────────────────────────
  権限は「できること」、担当は「どこまで」。工場担当は自分の工場、
  グループ担当は自分のグループの工場、PRTR 管理者は全部。
  **行単位の絞り込みは本システムで初めて。**PRTR の API は requirePermission の後に
  必ずここを通す（呼び忘れは authz-coverage.test.ts が見張る）
*/

export interface PrtrScope {
  /** PRTR 管理者。何でも見られる */
  all: boolean;
  /** グループ担当として担当しているグループ */
  groupIds: string[];
  /** 工場担当として担当している工場 */
  siteIds: string[];
}

/** その人の担当の範囲。一覧の絞り込みに使う */
export async function prtrScopeOf(actor: Actor): Promise<PrtrScope> {
  if (actor.has("PRTR_ADMIN")) return { all: true, groupIds: [], siteIds: [] };
  const rows = await prisma.prtrUserScope.findMany({
    where: { userId: actor.user.id },
    select: { siteId: true, groupId: true },
  });
  return {
    all: false,
    groupIds: actor.has("PRTR_GROUP")
      ? rows.map((r) => r.groupId).filter((v): v is string => v !== null)
      : [],
    siteIds: actor.has("PRTR_SITE")
      ? rows.map((r) => r.siteId).filter((v): v is string => v !== null)
      : [],
  };
}

/** 工場の一覧を担当の範囲で絞る Prisma の条件。範囲外の人には何も返さない */
export function prtrSiteWhere(scope: PrtrScope): Record<string, unknown> {
  if (scope.all) return {};
  return { OR: [{ id: { in: scope.siteIds } }, { groupId: { in: scope.groupIds } }] };
}

/** グループの一覧を担当の範囲で絞る条件。工場担当には自分の工場が属するグループだけ見せる */
export function prtrGroupWhere(scope: PrtrScope): Record<string, unknown> {
  if (scope.all) return {};
  return {
    OR: [{ id: { in: scope.groupIds } }, { sites: { some: { id: { in: scope.siteIds } } } }],
  };
}

/**
 * その工場（またはグループ）を触ってよいか。**範囲外は 404**
 * （存在を教えない。403 だと「あるが触れない」と分かってしまう）
 */
export async function requirePrtrScope(
  actor: Actor,
  target: { siteId?: string; groupId?: string },
): Promise<null | Response> {
  const scope = await prtrScopeOf(actor);
  if (scope.all) return null;
  let ok = false;
  if (target.siteId) {
    const site = await prisma.prtrSite.findFirst({
      where: { id: target.siteId, deletedAt: null },
      select: { groupId: true },
    });
    ok =
      site !== null &&
      (scope.siteIds.includes(target.siteId) || scope.groupIds.includes(site.groupId));
  } else if (target.groupId) {
    const g = target.groupId;
    ok = scope.groupIds.includes(g);
    if (!ok && scope.siteIds.length > 0) {
      // 工場担当は自分の工場が属するグループを見てよい（名前を出すため）
      const n = await prisma.prtrSite.count({
        where: { id: { in: scope.siteIds }, groupId: g, deletedAt: null },
      });
      ok = n > 0;
    }
  }
  if (ok) return null;
  const m = await getServerMessages();
  return jsonError(404, "not_found", m.errors.notFound);
}
