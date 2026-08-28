import { canEditAnything, type Permission } from "@chem/shared";
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
  return rows.map((r) => r.permission);
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
