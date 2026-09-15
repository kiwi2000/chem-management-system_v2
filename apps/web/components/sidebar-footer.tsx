"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n-client";

/**
 * 左メニューのいちばん下。法規制バージョンと、いまアクティブなセッションの数。
 *
 * 30秒おきに取り直す。数だけを出し、誰かは出さない（誰がいるかは守るべき情報）。
 * セッション管理の表の「アクティブ」の行数と同じ。管理者には表への入り口にもなる。
 *
 * **管理者には「要再計算」も出す。**法規制のデータが変わってから全製品の判定を
 * やり直していないあいだ、バージョンの上に黄色の印が付く。どの画面にいても目に入り、
 * 押すとシステム設定の「法規制の判定」に移る。一般の利用者には押せるボタンが無いので出さない
 */
export function SidebarFooter({
  version,
  isAdmin,
}: {
  version: { code: string; nameJa: string | null };
  isAdmin: boolean;
}) {
  const { m } = useI18n();
  const [count, setCount] = useState<number | null>(null);
  const [rejudgeNeeded, setRejudgeNeeded] = useState(false);
  /** 自分が頼んだ、まとめて作る帳票の仕事が走っている数 */
  const [docBatch, setDocBatch] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch("/api/sessions/count").catch(() => null);
      if (!res?.ok || !alive) return;
      const body = (await res.json()) as {
        sessions: number;
        rejudgeNeeded: boolean | null;
        docBatch?: number;
      };
      if (!alive) return;
      setCount(body.sessions);
      setRejudgeNeeded(body.rejudgeNeeded === true);
      setDocBatch(body.docBatch ?? 0);
    };
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const online = (
    <>
      <div className="text-muted-foreground text-xs">{m.shell.online}</div>
      <div className="text-primary text-lg leading-tight font-semibold tabular-nums">
        {count === null ? "—" : count.toLocaleString()}
      </div>
    </>
  );

  return (
    <div className="bg-muted/60 mt-auto border-t px-4 py-3">
      {/* まとめて作る帳票が裏で走っているあいだの印。どの画面にいても目に入り、押すと生成の画面へ */}
      {docBatch > 0 && (
        <Link
          href="/documents"
          className="text-primary mb-2 flex items-center gap-1.5 rounded-sm text-xs font-medium hover:opacity-80"
          title={m.shell.docBatchRunningHint}
        >
          <span
            aria-hidden
            className="bg-primary inline-block size-2 shrink-0 animate-pulse rounded-full"
          />
          {m.shell.docBatchRunning(docBatch)}
        </Link>
      )}
      {isAdmin && rejudgeNeeded && (
        <Link
          href="/admin/settings#rejudge"
          className="mb-2 flex items-center gap-1.5 rounded-sm text-xs font-medium text-amber-600 hover:opacity-80 dark:text-amber-400"
          title={m.shell.rejudgeNeededHint}
        >
          <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-amber-500" />
          {m.shell.rejudgeNeeded}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-muted-foreground text-xs">{m.shell.linkVersion}</div>
          <div className="text-primary truncate text-lg leading-tight font-semibold">
            {version.code}
          </div>
          {version.nameJa && (
            <div className="text-muted-foreground truncate text-xs">{version.nameJa}</div>
          )}
        </div>
        {/* いまログインしているセッションの数。バージョンの右に、同じ形で並べる */}
        {isAdmin ? (
          <Link
            href="/admin/sessions"
            className="block rounded-sm text-right hover:opacity-80"
            title={m.nav.sessions}
          >
            {online}
          </Link>
        ) : (
          <div className="text-right">{online}</div>
        )}
      </div>
      {/* 権利表示。ログイン後は常に見える場所に置く */}
      <div className="text-muted-foreground mt-2 text-[11px]">{m.common.copyright}</div>
    </div>
  );
}
