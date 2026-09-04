"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n-client";

/**
 * いまログインしている人数。左メニューの下、法規制バージョンの右に置く。
 *
 * 30秒おきに取り直す。数だけを出し、誰かは出さない（誰がいるかは守るべき情報）。
 * 管理者にはセッション管理への入り口にもなる（押すと移る）
 */
export function OnlineCount({ canOpenSessions }: { canOpenSessions: boolean }) {
  const { m } = useI18n();
  const [users, setUsers] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch("/api/sessions/count").catch(() => null);
      if (!res?.ok || !alive) return;
      const body = (await res.json()) as { users: number };
      if (alive) setUsers(body.users);
    };
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const body = (
    <>
      <div className="text-muted-foreground text-xs">{m.shell.online}</div>
      <div className="text-primary text-lg leading-tight font-semibold tabular-nums">
        {users === null ? "—" : m.shell.onlineCount(users)}
      </div>
    </>
  );

  return canOpenSessions ? (
    <Link
      href="/admin/sessions"
      className="block rounded-sm text-right hover:opacity-80"
      title={m.nav.sessions}
    >
      {body}
    </Link>
  ) : (
    <div className="text-right">{body}</div>
  );
}
