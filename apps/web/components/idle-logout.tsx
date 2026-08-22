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

/** 操作を数え直す間隔。マウスの移動は1秒に何十回も来るので、この間隔まで間引く */
const ACTIVITY_STEP_MS = 1_000;

/** サーバーに「まだ使っている」と知らせる間隔 */
const PING_STEP_MS = 60_000;

/**
 * 期限より早く起きてしまったときに、次に見直すまでの間隔。
 * タイマーは期限ちょうどを狙って仕掛けるが、早く起きることがあり得る。
 * そのまま何もしないと居座ってしまうので、少し置いてもう一度見る。
 */
const RECHECK_MS = 5_000;

export function IdleLogout({ idleMinutes }: { idleMinutes: number }) {
  useEffect(() => {
    const limit = idleMinutes * 60_000;
    let deadline = Date.now() + limit;
    let lastActivity = Date.now();
    let lastPing = Date.now();
    let timer = 0;
    let leaving = false;

    const leave = () => {
      if (leaving) return;
      leaving = true;
      // 出ていく前にサーバー側のセッションも消す（Cookie だけ残っても意味が無い）
      void fetch("/api/auth/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => window.location.replace(EXPIRED_LOGIN_URL));
    };

    /**
     * 期限を狙って1回だけ起きる。常時まわし続けるタイマーは持たない。
     * まだ期限前だったら、残り時間ぶん置いて仕掛け直す。
     */
    const schedule = () => {
      window.clearTimeout(timer);
      if (leaving) return;
      const remain = deadline - Date.now();
      if (remain <= 0) {
        leave();
        return;
      }
      timer = window.setTimeout(schedule, Math.max(remain, RECHECK_MS));
    };

    const onActivity = () => {
      if (leaving) return;
      const now = Date.now();
      if (now - lastActivity < ACTIVITY_STEP_MS) return;
      lastActivity = now;
      deadline = now + limit;
      schedule();

      // 知らせるのは1分に1回で足りる。毎回投げても、進む時計は同じ
      if (now - lastPing > PING_STEP_MS) {
        lastPing = now;
        void fetch("/api/auth/heartbeat", { method: "POST" }).catch(() => {});
      }
    };

    /*
     * 画面が隠れているあいだ、タイマーは止められていることがある（とくにスマホ）。
     * 戻ってきた時点で、経過時間を見て判断し直す。
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };

    /** マウスやゆびの移動も操作として数える。触っていれば切らない */
    const events = [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "touchstart",
      "scroll",
    ] as const;
    for (const name of events) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisible);
    schedule();

    return () => {
      for (const name of events) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(timer);
    };
  }, [idleMinutes]);

  return null;
}
