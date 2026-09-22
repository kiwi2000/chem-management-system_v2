"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n-client";
import { rejudgeProduct, useJudgementControls } from "@/lib/judgement-controls";

/**
 * 製品の「再計算」。押すと**判定対象日を尋ねてから**判定し直す（2026-09-22 決定）。
 * 既定は今日。その日に効いている規制区分・法文物質名で判定し、日付は判定に残る。
 * 判定表と原材料展開・CAS合算の表の両方に置くので、1 つの部品にしてある。
 * 判定を直せる人にだけ出す（出すかどうかは呼ぶ側）
 */
export function RejudgeButton({
  productId,
  today,
  onError,
}: {
  productId: string;
  /** サーバーの今日（日本の日付）。まだ分からなければブラウザの日付 */
  today: string | null;
  /** 失敗の文言の出し先。枠ごとに出し方が違うので呼ぶ側に任せる */
  onError: (message: string | null) => void;
}) {
  const { m } = useI18n();
  const controls = useJudgementControls();
  const [open, setOpen] = useState(false);
  const [asOf, setAsOf] = useState("");
  const fallback = today ?? new Date().toISOString().slice(0, 10);

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={controls.busy}
        title={m.judgements.rejudgeHint}
        onClick={() => {
          setAsOf(fallback);
          setOpen(true);
        }}
      >
        <RefreshCw className="mr-1 size-3.5" />
        {m.judgements.rejudge}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <label className="flex items-center gap-1 text-xs" title={m.judgements.rejudgeAsOfHint}>
        <span className="text-muted-foreground">{m.judgements.rejudgeAsOf}</span>
        <Input
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
          className="h-8 w-36"
          autoFocus
        />
      </label>
      <Button
        type="button"
        size="sm"
        disabled={controls.busy || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)}
        onClick={() => {
          onError(null);
          void rejudgeProduct(productId, asOf, m.errors.saveFailed).then((failed) => {
            if (failed) onError(failed);
          });
        }}
      >
        <RefreshCw className="mr-1 size-3.5" />
        {m.judgements.rejudgeRun}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {m.common.cancel}
      </Button>
    </span>
  );
}
