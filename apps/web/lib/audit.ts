import { prisma } from "@/lib/db";

/**
 * 監査ログ。
 * 監査書込の失敗で業務処理を失敗させない（ただしエラーは必ずログに残す）。
 */
export async function writeAudit(params: {
  entity: string;
  entityId?: string;
  action: "create" | "update" | "delete" | "login" | "determine" | "import" | "export";
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
