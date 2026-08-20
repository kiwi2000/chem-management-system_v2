"use client";

import { CircleCheck, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

interface Props {
  /** "products" か "substances" */
  entity: "products" | "substances";
  id: string;
  draftFlag: boolean;
  /** 編集できないときはボタンを出さない */
  canEdit: boolean;
}

/**
 * 作成中と完成の切り替え。
 * 保存とは分けた操作にしている。「とりあえず保存しておく」と
 * 「他の人に使わせてよい」を、はっきり別の意思表示にするため。
 */
export function DraftToggle({ entity, id, draftFlag, canEdit }: Props) {
  const router = useRouter();
  const { m } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/${entity}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], draftFlag: !draftFlag }),
      });
      if (!res.ok) {
        if (redirectIfUnauthorized(res)) return;
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {draftFlag && <Badge variant="secondary">{m.common.draftBadge}</Badge>}
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void toggle()}
        >
          {draftFlag ? (
            <>
              <CircleCheck className="mr-1 size-3.5" />
              {m.common.markDone}
            </>
          ) : (
            <>
              <Undo2 className="mr-1 size-3.5" />
              {m.common.markDraft}
            </>
          )}
        </Button>
      )}
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}
