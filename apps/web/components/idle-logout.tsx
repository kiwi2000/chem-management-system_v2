"use client";

import { useEffect } from "react";
import { EXPIRED_LOGIN_URL } from "@/lib/routes";

/**
 * 操作が無いまま時間が過ぎたら、自分からログイン画面へ出ていく。
 *
 * 打ち切りの判断はサーバー側でも行っているが、それだけだと
 * 「次に何か操作したとき」まで画面が居座る。席を離れた端末に中身が映ったままになるので、
 * 時間が来たらこちらから出ていく。
 *
 * 画面を触っているだけでは通信が起きない。放っておくとサーバー側の時計だけが進み、
 * 長い入力の途中で打ち切られてしまうので、操作が続いているあいだは時々知らせる。
 */
export function IdleLogout({ idleMinutes }: { idleMinutes: number }) {
  useEffect(() => {
    const limit = idleMinutes * 60_000;
    let lastActivity = Date.now();
    let lastPing = Date.now();
    let leaving = false;

    const leave = () => {
      if (leaving) return;
      leaving = true;
      // 出ていく前にサーバー側のセッションも消す（Cookie だけ残っても意味が無い）
      void fetch("/api/auth/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => window.location.replace(EXPIRED_LOGIN_URL));
    };

    const onActivity = () => {
      if (leaving) return;
      const now = Date.now();
      lastActivity = now;
      // 知らせるのは1分に1回で足りる。毎回投げても時計は同じだけしか進まない
      if (now - lastPing > 60_000) {
        lastPing = now;
        void fetch("/api/auth/heartbeat", { method: "POST" }).catch(() => {});
      }
    };

    const check = () => {
      if (Date.now() - lastActivity > limit) leave();
    };

    /*
     * 画面が隠れているあいだ、タイマーは止められていることがある（とくにスマホ）。
     * 戻ってきた時点で、経過時間を見て判断し直す。
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const name of events) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, 15_000);

    return () => {
      for (const name of events) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [idleMinutes]);

  return null;
}
