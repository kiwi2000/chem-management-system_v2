import type { User as AppUser } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { getServerMessages } from "@/lib/i18n";

/**
 * 認可ポリシー（単一モジュールに集中: CLAUDE.md §4）。
 * すべての API Route Handler はここを必ず通すこと。クライアント側の制御だけに頼らない。
 */

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return Response.json({ error: { code, message, details } }, { status });
}

/** 認証必須。未認証は 401 Response を返す */
export async function requireUser(): Promise<{ user: AppUser } | Response> {
  const user = await getSessionUser();
  if (!user) {
    const m = await getServerMessages();
    return jsonError(401, "unauthorized", m.errors.unauthorized);
  }
  return { user };
}

/** 編集権限: 管理者・特権は常に可。非特権は canEdit による */
export function canEdit(user: AppUser): boolean {
  return user.role === "SYSTEM_ADMIN" || user.role === "PRIVILEGED" || user.canEdit;
}

/** 編集操作（登録・変更・削除・一括取込）に必須。権限なしは 403 */
export async function requireEditor(): Promise<{ user: AppUser } | Response> {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  if (!canEdit(auth.user)) {
    const m = await getServerMessages();
    return jsonError(403, "forbidden", m.errors.forbiddenEdit);
  }
  return auth;
}

/** システム管理者のみ（ユーザー管理・システム設定） */
export async function requireAdmin(): Promise<{ user: AppUser } | Response> {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  if (auth.user.role !== "SYSTEM_ADMIN") {
    const m = await getServerMessages();
    return jsonError(403, "forbidden", m.errors.forbiddenAdmin);
  }
  return auth;
}

/** 特権以上（全製品・全組成の閲覧、フラグ設定など） */
export function isPrivileged(user: AppUser): boolean {
  return user.role === "SYSTEM_ADMIN" || user.role === "PRIVILEGED";
}
