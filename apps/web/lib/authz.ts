import {
  canEditAnything,
  DATA_PERMISSIONS,
  expandPermissions,
  GROUP_PERMISSIONS,
  isPermission,
  PERMISSION_MARKS,
  PERMISSIONS,
  type Permission,
  type PermissionMark,
} from "@chem/shared";
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
 * S31 から、人の権限は入っている管理グループを合わせたもの（仕様 6-6）。
 * - `permissions` / `has` … 表とは別の権限に、表の印から作った製品・組成・物質の 5 つと、
 *   システム管理グループなら `ADMIN` を足したもの。**入口の確かめ（その画面・API に入れるか）に使う**
 * - `scope` … 表の印ごとの「対象にできる所属先（管理グループの id）」。**どのデータかの確かめに使う**
 *   （`ownerWhere` / `canOn`）。システム管理グループの人は `all`
 */

/** 印ごとの対象にできる所属先。`all` はシステム管理グループ（印に関係なく全部） */
export type ActorScope = "all" | Record<PermissionMark, ReadonlySet<string>>;

export interface Actor {
  user: AppUser;
  permissions: Permission[];
  has: (p: Permission) => boolean;
  /** システム管理グループに入っているか */
  isSystemAdmin: boolean;
  scope: ActorScope;
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return Response.json({ error: { code, message, details } }, { status });
}

/** 表の印から作る製品・組成・物質の権限（どこかの所属先に対して印を持てば付く） */
const MARK_PERMISSION: Partial<Record<PermissionMark, Permission>> = {
  productView: "PRODUCT_VIEW",
  productEdit: "PRODUCT_EDIT",
  compositionView: "COMPOSITION_VIEW",
  substanceView: "SUBSTANCE_VIEW",
  substanceEdit: "SUBSTANCE_EDIT",
};

/** 入っている管理グループから、その人の権限と印の対象を組み立てる */
async function buildActor(user: AppUser): Promise<Actor> {
  const memberships = await prisma.userPermissionGroup.findMany({
    where: { userId: user.id },
    select: {
      group: {
        select: {
          isSystemAdmin: true,
          permissions: { select: { permission: true } },
          rows: {
            select: {
              targetGroupId: true,
              productView: true,
              productEdit: true,
              compositionView: true,
              compositionEdit: true,
              substanceView: true,
              substanceEdit: true,
            },
          },
        },
      },
    },
  });
  const isSystemAdmin = memberships.some((m) => m.group.isSystemAdmin);
  if (isSystemAdmin) {
    // 何でもできる（仕様 9 章）
    const permissions = [...PERMISSIONS];
    return { user, permissions, has: () => true, isSystemAdmin, scope: "all" };
  }

  const scope = Object.fromEntries(PERMISSION_MARKS.map((k) => [k, new Set<string>()])) as Record<
    PermissionMark,
    Set<string>
  >;
  const granted = new Set<Permission>();
  for (const { group } of memberships) {
    for (const row of group.rows) {
      for (const k of PERMISSION_MARKS) if (row[k]) scope[k].add(row.targetGroupId);
    }
    // DB の enum にだけ残っている古い値（無効・未公開、送り主）は無いものとして扱う。
    // 製品・組成・物質と管理者の権限は、管理グループに付いていても使わない（表の印と管理グループで決まる）
    for (const { permission } of group.permissions) {
      if (isPermission(permission) && GROUP_PERMISSIONS.includes(permission)) {
        granted.add(permission);
      }
    }
  }
  const fromGroups = expandPermissions(granted);
  const fromMarks = PERMISSION_MARKS.flatMap((k) => {
    const p = MARK_PERMISSION[k];
    return p && scope[k].size > 0 ? [p] : [];
  });
  const set = new Set<Permission>([...fromGroups, ...fromMarks]);
  const permissions = PERMISSIONS.filter((p) => set.has(p));
  return { user, permissions, has: (p) => set.has(p), isSystemAdmin, scope };
}

/**
 * ログイン中のユーザーと権限。未ログインなら null。
 * ページ（サーバーコンポーネント）から使う。API からは requireUser を使うこと。
 */
export async function getActor(): Promise<Actor | null> {
  const user = await getSessionUser().catch(() => null);
  if (!user) return null;
  return buildActor(user);
}

/**
 * 利用者IDから Actor を組み立てる。**バックグラウンド処理用。**
 * 画面や API の外（まとめて帳票を作る仕事など）で、頼んだ人の権限のまま動くために使う。
 * 消された・止められた利用者なら null
 */
export async function actorOf(userId: string): Promise<Actor | null> {
  const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!user || !user.activeFlag) return null;
  return buildActor(user);
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
  ── データの所属先（S31）───────────────────────────────
  製品・原材料・物質は 1 つの管理グループに所属する。見られる・直せるかは、
  その人の表の、所属先の行の印で決まる（仕様 6・7 章）。
*/

/**
 * その印を持つ所属先に限る条件（Prisma の where に AND で足す）。
 * システム管理グループは条件なし。**印が 1 つも無いときは何も当たらない条件**（`{}` にしない）
 */
export function ownerWhere(
  actor: Actor,
  mark: PermissionMark,
): { ownerGroupId?: { in: string[] } } {
  if (actor.scope === "all") return {};
  return { ownerGroupId: { in: [...actor.scope[mark]] } };
}

/** その所属先のデータに、その印でできるか */
export function canOn(actor: Actor, mark: PermissionMark, ownerGroupId: string): boolean {
  if (actor.scope === "all") return true;
  return actor.scope[mark].has(ownerGroupId);
}

/** どこかの所属先に、その印を持つか（入口の確かめ。組成の編集など、権限の名前が無い印に使う） */
export function hasMark(actor: Actor, mark: PermissionMark): boolean {
  return actor.scope === "all" || actor.scope[mark].size > 0;
}

/** その印を持つ所属先の id（システム管理グループは null = 全部） */
export function scopeIds(actor: Actor, mark: PermissionMark): string[] | null {
  if (actor.scope === "all") return null;
  return [...actor.scope[mark]];
}

/** 製品・組成・物質の権限が、表の印から作られたものか（管理グループの欄には出さない） */
export function isDataPermission(p: Permission): boolean {
  return (DATA_PERMISSIONS as readonly Permission[]).includes(p);
}

/*
  ── PRTR 届出データの所属（S22）───────────────────────────
  権限 PRTR_ENTRY は「入力できる」、所属（利用者の組織）は「どこの分を」。
  PRTR の API は requirePermission の後に必ずここを通す（呼び忘れは authz-coverage.test.ts が見張る）
*/

/**
 * その人が届出データを入れられる組織（所属している組織）。PRTR_ENTRY が無ければ空。
 * S31 から人の組織は 1 つ。PRTR の分け方は別途検討（仕様 6-3）で、決まるまでは今の考え方のまま
 */
export async function prtrOrgsOf(actor: Actor): Promise<string[]> {
  if (!actor.has("PRTR_ENTRY")) return [];
  const id = actor.user.organisationId;
  if (!id) return [];
  const org = await prisma.organisation.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  return org ? [org.id] : [];
}

/**
 * その組織の届出データを触ってよいか。**所属していなければ 404**
 * （存在を教えない。403 だと「あるが触れない」と分かってしまう）
 */
export async function requirePrtrOrg(
  actor: Actor,
  organisationId: string,
): Promise<null | Response> {
  const orgs = await prtrOrgsOf(actor);
  if (orgs.includes(organisationId)) return null;
  const m = await getServerMessages();
  return jsonError(404, "not_found", m.errors.notFound);
}
