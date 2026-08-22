"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
 *
 * 残りが少なくなったらツールバーに時計を出す（IdleCountdown）。
 * ふだんは出さない。残り8分と知っても、することが無いため。
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

/** 残りがこれを切ったら時計を出す。上限を短く設定したときは、その1/3まで縮める */
const warnWindow = (limit: number) => Math.min(2 * 60_000, Math.floor(limit / 3));

/** 残りがこれを切ったら色を変える。出ている時間の半分は超えない */
const alarmWindow = (warn: number) => Math.min(30_000, Math.floor(warn / 2));

interface Countdown {
  /** 残りミリ秒。まだ出す時間でなければ null */
  remainMs: number | null;
  /** 色を変える段階か */
  alarm: boolean;
}

const CountdownContext = createContext<Countdown>({ remainMs: null, alarm: false });

/** ツールバーの時計が読む。ここに値が入るのは、残りが少なくなったときだけ */
export function useIdleCountdown(): Countdown {
  return useContext(CountdownContext);
}

/**
 * 短く2回鳴らす。音声ファイルは持たず、その場で作る。
 * そのページで一度も操作していないとブラウザが止めるので、鳴らないことがある。
 */
function beep() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const play = (offset: number, freq: number) => {
      const at = ctx.currentTime + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // 立ち上がりと切れ際をなだらかにする。角があると耳障りな「プツ」が入る
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.05, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.1);
    };
    play(0, 880);
    play(0.13, 1175);
    window.setTimeout(() => void ctx.close(), 800);
  } catch {
    // 鳴らせない環境では黙って諦める。知らせる手段は画面のほうにもある
  }
}

export function IdleGuard({
  idleMinutes,
  enabled,
  children,
}: {
  idleMinutes: number;
  /** ログインしていない画面では時計を回さない */
  enabled: boolean;
  children: ReactNode;
}) {
  const [countdown, setCountdown] = useState<Countdown>({ remainMs: null, alarm: false });

  useEffect(() => {
    if (!enabled) return;

    const limit = idleMinutes * 60_000;
    const warn = warnWindow(limit);
    const alarmAt = alarmWindow(warn);
    let deadline = Date.now() + limit;
    let lastActivity = Date.now();
    let lastPing = Date.now();
    let timer = 0;
    let ticker = 0;
    let showing = false;
    let leaving = false;

    const leave = () => {
      if (leaving) return;
      leaving = true;
      window.clearInterval(ticker);
      // 出ていく前にサーバー側のセッションも消す（Cookie だけ残っても意味が無い）
      void fetch("/api/auth/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => window.location.replace(EXPIRED_LOGIN_URL));
    };

    /** 出ているあいだだけ秒を刻む。それ以外の時間はタイマーを持たない */
    const tick = () => {
      const remain = deadline - Date.now();
      if (remain <= 0) {
        leave();
        return;
      }
      setCountdown({ remainMs: remain, alarm: remain <= alarmAt });
    };

    const startShowing = () => {
      // 何度呼ばれても、そのつど今の残りを出す。
      // 画面が隠れているあいだ秒の刻みは止められるので、戻ったときに数字が古いままになる
      tick();
      if (showing) return;
      showing = true;
      ticker = window.setInterval(tick, 1_000);
      beep();
    };

    const stopShowing = () => {
      if (!showing) return;
      showing = false;
      window.clearInterval(ticker);
      setCountdown({ remainMs: null, alarm: false });
    };

    /**
     * 期限を狙って1回だけ起きる。常時まわし続けるタイマーは持たない。
     * 出す時刻（期限の少し前）と、期限そのものの2段構えで仕掛ける。
     */
    const schedule = () => {
      window.clearTimeout(timer);
      if (leaving) return;
      const remain = deadline - Date.now();
      if (remain <= 0) {
        leave();
        return;
      }
      if (remain <= warn) {
        startShowing();
        // 出したあとは1秒ごとの刻みが期限を見るので、別に仕掛け直さない
        return;
      }
      stopShowing();
      timer = window.setTimeout(schedule, Math.max(remain - warn, RECHECK_MS));
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
     * 画面が隠れているあいだ、ブラウザはタイマーを止める（とくにスマホ）。
     * その間このページは時間を数えていないので、戻ってきたときの残り時間は当てにならない。
     * 画面の時計ではなく、サーバーに聞き直す。過ぎていればその場で出ていく。
     */
    const onVisible = () => {
      if (document.visibilityState !== "visible" || leaving) return;
      void (async () => {
        const res = await fetch("/api/auth/session-status", { cache: "no-store" }).catch(
          () => null,
        );
        if (leaving) return;
        if (!res) {
          // 通信できないときは画面の時計で判断する（繋がらないだけかもしれない）
          schedule();
          return;
        }
        if (res.status === 401) {
          leave();
          return;
        }
        const body = (await res.json().catch(() => null)) as { remainMs?: number } | null;
        // サーバーが持っている残り時間を正とする
        if (typeof body?.remainMs === "number") deadline = Date.now() + body.remainMs;
        schedule();
      })();
    };

    /*
     * 意図のある操作だけを数える。
     * マウスが画面の上を通っただけでは数えない。机の振動や袖が触れただけでも起きるので、
     * それで延命すると、席を離れた端末がいつまでも開いたままになる。
     *
     * input を入れているのは、右クリックからの貼り付けがキー入力を伴わないため。
     */
    const events = ["pointerdown", "keydown", "input", "wheel", "touchstart", "scroll"] as const;
    for (const name of events) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisible);
    schedule();

    return () => {
      for (const name of events) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(timer);
      window.clearInterval(ticker);
    };
  }, [idleMinutes, enabled]);

  return <CountdownContext.Provider value={countdown}>{children}</CountdownContext.Provider>;
}
