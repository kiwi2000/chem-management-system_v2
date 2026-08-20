"use client";

import { ALLOWED_FROM, type ApprovalActionInput, type PublishState } from "@chem/shared";
import { CircleCheck, CircleX, Send, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

interface Props {
  entity: "products" | "substances";
  id: string;
  publishState: PublishState;
  /** この種類のデータに承認が要るか（システム設定） */
  approvalRequired: boolean;
  /** 編集できるか。申請・発行・作成中に戻す が出せる条件 */
  canEdit: boolean;
  /** 承認できるか。承認・却下 が出せる条件 */
  canApprove: boolean;
}

/** 状態ごとの見た目。公開済だけ落ち着いた色にし、手が要るものを目立たせる */
const BADGE_CLASS: Record<PublishState, string> = {
  DRAFT:
    "border border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500/60 dark:bg-amber-500/20 dark:text-amber-200",
  PENDING:
    "border border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-500/60 dark:bg-blue-500/20 dark:text-blue-200",
  REJECTED:
    "border border-red-400 bg-red-100 text-red-900 dark:border-red-500/60 dark:bg-red-500/20 dark:text-red-200",
  PUBLISHED:
    "border border-emerald-400 bg-emerald-100 text-emerald-900 dark:border-emerald-500/60 dark:bg-emerald-500/20 dark:text-emerald-200",
};

/**
 * 公開の状態と、その状態でできる操作。
 *
 * 保存とは分けた操作にしている。「とりあえず保存しておく」と
 * 「他の人に使わせてよい」を、はっきり別の意思表示にするため。
 */
export function PublishActions({
  entity,
  id,
  publishState,
  approvalRequired,
  canEdit,
  canApprove,
}: Props) {
  const router = useRouter();
  const { m } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);

  async function run(action: ApprovalActionInput, comment?: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/${entity}/publish-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], action, comment }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      setAskReason(false);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /** その操作をいまの状態で出してよいか */
  const can = (action: ApprovalActionInput) => ALLOWED_FROM[action].includes(publishState);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge className={`px-3 py-1 text-sm font-semibold ${BADGE_CLASS[publishState]}`}>
          {m.common.publishStates[publishState]}
        </Badge>

        {canEdit && approvalRequired && can("submit") && (
          <Button type="button" size="lg" disabled={busy} onClick={() => void run("submit")}>
            <Send className="mr-1 size-4" />
            {m.common.submit}
          </Button>
        )}
        {canEdit && !approvalRequired && can("publish") && (
          <Button type="button" size="lg" disabled={busy} onClick={() => void run("publish")}>
            <CircleCheck className="mr-1 size-4" />
            {m.common.publish}
          </Button>
        )}
        {canEdit && can("withdraw") && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={() => void run("withdraw")}
          >
            <Undo2 className="mr-1 size-4" />
            {m.common.withdraw}
          </Button>
        )}
        {canApprove && can("approve") && (
          <Button type="button" size="lg" disabled={busy} onClick={() => void run("approve")}>
            <CircleCheck className="mr-1 size-4" />
            {m.common.approve}
          </Button>
        )}
        {canApprove && can("reject") && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            className="text-destructive"
            onClick={() => setAskReason((v) => !v)}
          >
            <CircleX className="mr-1 size-4" />
            {m.common.reject}
          </Button>
        )}
        {canEdit && can("unpublish") && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={busy}
            onClick={() => void run("unpublish")}
          >
            <Undo2 className="mr-1 size-4" />
            {m.common.unpublish}
          </Button>
        )}
      </div>

      {askReason && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={m.common.rejectReason}
            maxLength={500}
            className="w-96"
          />
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void run("reject", reason)}
          >
            {m.common.reject}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAskReason(false)}>
            {m.common.cancel}
          </Button>
        </div>
      )}

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
