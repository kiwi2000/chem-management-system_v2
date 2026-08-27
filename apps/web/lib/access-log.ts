import { headers } from "next/headers";
import { writeAudit } from "@/lib/audit";
import { clientIp } from "@/lib/ip-allow";

/**
 * 組成を見たことを残す。
 *
 * 組成はこの会社にとって外に出てはいけないものだが、**暗号化では守れない漏れかたがある。**
 * 見る権利のある人が正規の手順で開き、そのまま持ち出す、という形である。
 * このとき中身は正しく復号されて渡るので、暗号化は何の役にも立たない。
 *
 * ここに効くのは「誰がいつ何を見たか」が残っていることで、
 * **残ると分かっていること自体**が抑えになる。だからこの記録は、
 * 管理者が読める画面まで用意して初めて意味を持つ。
 *
 * 1件ずつ残す。まとめたり間引いたりしない。
 * 「1日で200製品の組成を開いた」という**件数そのものが手がかり**なので、
 * 減らすと肝心の signal が消える。
 */
export async function recordCompositionView(params: {
  productId: string;
  actorId: string;
  /** 返した行数。あとから復元できないのでここに残す */
  lineCount: number;
  /** 末端の物質まで下ろした表かどうか。こちらのほうが持ち出しの価値が高い */
  expanded: boolean;
}): Promise<void> {
  await writeAudit({
    entity: "composition",
    entityId: params.productId,
    action: "view",
    actorId: params.actorId,
    diff: {
      lineCount: params.lineCount,
      expanded: params.expanded,
      ...(await callerInfo()),
    },
  });
}

/** どこから見たか。持ち出しの記録では「社内からか、外からか」が効く */
async function callerInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const hdrs = await headers();
    return {
      ip: clientIp(hdrs.get("x-forwarded-for")),
      userAgent: hdrs.get("user-agent")?.slice(0, 200) ?? null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}
