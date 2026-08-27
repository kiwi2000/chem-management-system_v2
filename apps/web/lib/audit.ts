import { prisma } from "@/lib/db";

/**
 * 監査ログ。
 * 監査書込の失敗で業務処理を失敗させない（ただしエラーは必ずログに残す）。
 */
export async function writeAudit(params: {
  entity: string;
  entityId?: string;
  action:
    | "create"
    | "update"
    | "delete"
    | "login"
    | "login_failed"
    | "logout"
    | "determine"
    | "import"
    | "export"
    /** 組成を見た。持ち出しの記録として残す */
    | "view"
    /*
      2要素認証の付け外し。**入口の出来事としてアクセス記録に出す。**
      パスワードだけを知っている相手が本人より先に登録してしまう筋があるので、
      身に覚えのない登録に本人と管理者が気づけるようにしておく
    */
    | "mfa_enable"
    | "mfa_disable";
  actorId?: string;
  diff?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entity: params.entity,
        entityId: params.entityId,
        action: params.action,
        actorId: params.actorId,
        diff: params.diff === undefined ? undefined : JSON.parse(JSON.stringify(params.diff)),
      },
    });
  } catch (e) {
    console.error("audit log write failed:", params.entity, params.action, e);
  }
}
