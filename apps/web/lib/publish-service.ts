import {
  ALLOWED_FROM,
  HISTORY_ACTION,
  NEXT_STATE,
  type ApprovalActionInput,
  type Messages,
  type PublishState,
  type TableState,
} from "@chem/shared";
import type { ApprovalAction } from "@prisma/client";
import { jsonError, type Actor } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { APPROVAL_EVENT_COLUMNS } from "@/lib/list-columns";
import { buildOrderBy, buildWhere } from "@/lib/table-query";

/** 履歴の1件。画面に出す形 */
export interface ApprovalEventDto {
  id: string;
  action: string;
  actorName: string;
  comment: string | null;
  createdAt: string;
}

/**
 * できなかった理由。
 * 「権限が無い」と「その状態では対象にならない」は原因が違うので、種類で分けて返す。
 */
export type TransitionDenial =
  | { code: "state"; state: PublishState }
  | { code: "setting"; message: string }
  | { code: "forbidden" };

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
}): TransitionDenial | null {
  const { action, from, approvalRequired, actor, canEdit, m } = params;

  if (!ALLOWED_FROM[action].includes(from)) return { code: "state", state: from };

  if (action === "submit" && !approvalRequired) {
    return { code: "setting", message: m.errors.approvalNotRequired };
  }
  if (action === "publish" && approvalRequired) {
    return { code: "setting", message: m.errors.approvalRequired };
  }

  // 承認と却下は承認の権限。それ以外は対象を編集できることが条件
  if (action === "approve" || action === "reject") {
    return actor.has("APPROVE") ? null : { code: "forbidden" };
  }
  return canEdit ? null : { code: "forbidden" };
}

/**
 * 1件も処理できなかったときの返事。
 * 状態が合わないだけなのに「権限がありません」と返すと原因を取り違えるため、理由で出し分ける。
 */
export function denialError(denials: TransitionDenial[], m: Messages): Response {
  const setting = denials.find(
    (d): d is Extract<TransitionDenial, { code: "setting" }> => d.code === "setting",
  );
  if (setting) return jsonError(409, "publish_state_mismatch", setting.message);

  const states = [...new Set(denials.flatMap((d) => (d.code === "state" ? [d.state] : [])))];
  if (states.length > 0) {
    const labels = states.map((st) => m.common.publishStates[st]).join("・");
    return jsonError(409, "publish_state_mismatch", m.errors.publishStateMismatch(labels));
  }
  return jsonError(403, "forbidden", m.errors.forbidden);
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

/**
 * 履歴を新しい順に取る。
 *
 * **ほかの一覧と同じく、ページで送る**（2026-09-18 指示）。
 * 以前は直近 50 件で打ち切っていて、それが全部のように見えていた
 */
export async function listApprovalEvents(
  entity: "substance" | "product",
  entityId: string,
  state: TableState,
): Promise<{ items: ApprovalEventDto[]; total: number; page: number; pageSize: number }> {
  const where = { entity, entityId, ...buildWhere(APPROVAL_EVENT_COLUMNS, state.filters) };
  const [rows, total] = await Promise.all([
    prisma.approvalEvent.findMany({
      where,
      orderBy: buildOrderBy(APPROVAL_EVENT_COLUMNS, state.sort, { createdAt: "desc" }),
      skip: (state.page - 1) * state.pageSize,
      take: state.pageSize,
      // 名前は関連から引く（並べ替え・絞り込みも DB 側で効く）
      include: { actor: { select: { displayName: true, email: true } } },
    }),
    prisma.approvalEvent.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      // 表示名が無ければメール。どちらも無い（その人の行が消えている）ときは「-」
      actorName: r.actor ? (r.actor.displayName ?? r.actor.email) : "-",
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page: state.page,
    pageSize: state.pageSize,
  };
}
