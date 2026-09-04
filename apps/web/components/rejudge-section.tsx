"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError } from "@/lib/types";

interface RejudgeStatus {
  running: boolean;
  total: number;
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  versionCode: string | null;
  error: string | null;
}

interface Body {
  status: RejudgeStatus;
  lastComputedAt: string | null;
  oldestComputedAt: string | null;
}

/**
 * 「全製品を判定し直す」。システム設定の「法規制の判定」の中に置く。
 *
 * 押すと裏で回り始めるので、**数秒おきに進み具合を聞いて**表示を更新する。
 * 走っているあいだにこの画面を開いた人にも、同じ進み具合が見える
 * （進み具合はサーバーが持っている）。
 */
export function RejudgeSection() {
  const { m, locale } = useI18n();
  const [body, setBody] = useState<Body | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/rejudge").catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (redirectIfUnauthorized(res)) return;
      return;
    }
    setBody((await res.json()) as Body);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 左メニューの「要再計算」から来た人を、この欄まで送る（設定の画面は長い）
  useEffect(() => {
    if (window.location.hash !== "#rejudge") return;
    document.getElementById("rejudge")?.scrollIntoView({ block: "center" });
  }, []);

  // 走っているあいだは 2 秒おきに進み具合を取り直す
  const running = body?.status.running ?? false;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(id);
  }, [running, load]);

  async function start() {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/admin/rejudge", { method: "POST" });
      if (!res.ok && res.status !== 409) {
        if (redirectIfUnauthorized(res)) return;
        const b = (await res.json().catch(() => null)) as ApiError | null;
        setError(b?.error.message ?? m.errors.saveFailed(res.status));
        return;
      }
      if (res.status === 409) setError(m.settings.rejudgeBusy);
      setBody((await res.json()) as Body);
    } finally {
      setStarting(false);
    }
  }

  const s = body?.status;
  const when = (iso: string) => new Date(iso).toLocaleString(locale);
  /** 進み具合、または前回の結果。何も無ければ DB に残っている判定の最終計算日時 */
  const line = !s
    ? null
    : s.running
      ? m.settings.rejudgeRunning(s.done, s.total)
      : s.error
        ? m.settings.rejudgeFailed(s.error)
        : s.finishedAt
          ? m.settings.rejudgeDone(s.done, when(s.finishedAt), s.versionCode ?? "")
          : body?.lastComputedAt
            ? m.settings.rejudgeLast(when(body.lastComputedAt))
            : m.settings.rejudgeNever;

  return (
    <div id="rejudge" className="scroll-mt-24 space-y-2 border-t pt-4">
      <Label>{m.settings.rejudge}</Label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={running || starting}
          onClick={() => void start()}
        >
          <RefreshCw className={running ? "mr-1 size-3.5 animate-spin" : "mr-1 size-3.5"} />
          {m.settings.rejudge}
        </Button>
        {line && (
          <span className={s?.error ? "text-destructive text-sm" : "text-muted-foreground text-sm"}>
            {line}
          </span>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{m.settings.rejudgeHint}</p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
