import {
  ALLOWED_FROM,
  HISTORY_ACTION,
  NEXT_STATE,
  type ApprovalActionInput,
  type Messages,
  type PublishState,
} from "@chem/shared";
import type { ApprovalAction } from "@prisma/client";
import type { Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";

/** 履歴の1件。画面に出す形 */
export interface ApprovalEventDto {
  id: string;
  action: string;
  actorName: string;
  comment: string | null;
  createdAt: string;
}

/**
 * その操作をしてよいか。
 * 状態の遷移が正しいかと、権限が足りているかの両方を見る。
 * 承認が要るかどうかで submit と publish を出し分ける（両方は使えない）。
 */
export function checkTransition(params: {
  action: ApprovalActionInput;
  from: PublishState;
  approvalRequired: boolean;
  actor: Actor;
  canEdit: boolean;
  m: Messages;
}): string | null {
  const { action, from, approvalRequired, actor, canEdit, m } = params;

  if (!ALLOWED_FROM[action].includes(from)) return m.errors.publishStateMismatch;

  if (action === "submit" && !approvalRequired) return m.errors.approvalNotRequired;
  if (action === "publish" && approvalRequired) return m.errors.approvalRequired;

  // 承認と却下は承認の権限。それ以外は対象を編集できることが条件
  if (action === "approve" || action === "reject") {
    return actor.has("APPROVE") ? null : m.errors.forbidden;
  }
  return canEdit ? null : m.errors.forbidden;
}

/** 履歴を1件書く。業務処理を止めないよう、失敗しても投げない */
export async function writeApprovalEvent(params: {
  entity: "substance" | "product";
  entityId: string;
  action: ApprovalActionInput;
  actorId: string;
  comment?: string;
}): Promise<void> {
  try {
    await prisma.approvalEvent.create({
      data: {
        entity: params.entity,
        entityId: params.entityId,
        action: HISTORY_ACTION[params.action] as ApprovalAction,
        actorId: params.actorId,
        comment: params.comment?.trim() || null,
      },
    });
  } catch (e) {
    console.error("approval event write failed:", params.entity, params.action, e);
  }
}

/** 操作したあとの状態 */
export const nextStateOf = (action: ApprovalActionInput): PublishState => NEXT_STATE[action];

/**
 * 公開済の組成から参照されているか。
 * 参照されている間は公開を取り消せない（公開済の製品が、使えない構成要素を含んでしまうため）。
 * 返すのは対象の製品コード（最大10件）。
 */
export async function publishedParentsOf(
  entity: "substance" | "product",
  id: string,
): Promise<string[]> {
  const rows = await prisma.compositionLine.findMany({
    where: {
      ...(entity === "substance" ? { substanceId: id } : { childProductId: id }),
      parentProduct: { deletedAt: null, publishState: "PUBLISHED" },
    },
    select: { parentProduct: { select: { code: true } } },
    take: 10,
  });
  return [...new Set(rows.map((r) => r.parentProduct.code))];
}

/** 履歴を新しい順に取る */
export async function listApprovalEvents(
  entity: "substance" | "product",
  entityId: string,
): Promise<ApprovalEventDto[]> {
  const rows = await prisma.approvalEvent.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const actorIds = [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))];
  const users = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, displayName: true, email: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.displayName ?? u.email]));

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    actorName: r.actorId ? (nameById.get(r.actorId) ?? "-") : "-",
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
  }));
}
