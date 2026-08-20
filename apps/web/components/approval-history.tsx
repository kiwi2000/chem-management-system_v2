"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n-client";

interface Event {
  id: string;
  action: string;
  actorName: string;
  comment: string | null;
  createdAt: string;
}

/**
 * 申請・承認・却下の履歴。新しい順。
 * 見られるのは編集できる人と承認できる人だけ（サーバー側で判断する）。
 */
export function ApprovalHistory({
  entity,
  entityId,
}: {
  entity: "product" | "substance";
  entityId: string;
}) {
  const { m, locale } = useI18n();
  const [items, setItems] = useState<Event[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/approval-events?entity=${entity}&entityId=${encodeURIComponent(entityId)}`,
    );
    if (!res.ok) {
      setItems([]);
      return;
    }
    setItems(((await res.json()) as { items: Event[] }).items);
  }, [entity, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 見る権限が無い人には節ごと出さない
  if (items === null || items.length === 0) return null;

  const label = (action: string) =>
    ({
      SUBMIT: m.common.submit,
      APPROVE: m.common.approve,
      REJECT: m.common.reject,
      WITHDRAW: m.common.withdraw,
      UNPUBLISH: m.common.unpublish,
    })[action] ?? action;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{m.common.approvalHistory}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((e) => (
          <div key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground w-40 shrink-0 text-xs">
              {new Date(e.createdAt).toLocaleString(locale)}
            </span>
            <span className="font-medium">{label(e.action)}</span>
            <span className="text-muted-foreground">{e.actorName}</span>
            {e.comment && <span className="text-muted-foreground text-xs">{e.comment}</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
