/**
 * サーバーの見回り（2026-10-17）。
 *
 * 起動時に instrumentation.ts から 1 回だけ呼ばれ、1 時間おきに裏の片づけを起こす。
 * いまはアクセス記録の保存期間（lib/access-log-retention.ts）だけ。
 * 1 日 1 回しか走らない決まりは、呼ばれる側が DB の印で守る（ここでは時刻を数えない）。
 *
 * next dev は共有モジュールを作り直すことがあるので、二重に起こさないよう印は globalThis に置く。
 * タイマーは unref して、止めるときにプロセスを引き止めない
 */

const FIRST_DELAY_MS = 2 * 60 * 1000;
const INTERVAL_MS = 60 * 60 * 1000;

declare global {
  var __chemMaintenanceTimer: NodeJS.Timeout | undefined;
}

async function tick(): Promise<void> {
  try {
    const { runAccessLogRetention } = await import("@/lib/access-log-retention");
    await runAccessLogRetention();
  } catch (err) {
    console.error("[maintenance] access log retention failed", err);
  }
}

export function startMaintenanceTimer(): void {
  if (globalThis.__chemMaintenanceTimer) return;
  // 起動直後は DB の移行や立ち上がりと重なるので、少し待ってから最初の見回り
  const first = setTimeout(() => void tick(), FIRST_DELAY_MS);
  first.unref();
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref();
  globalThis.__chemMaintenanceTimer = timer;
}
