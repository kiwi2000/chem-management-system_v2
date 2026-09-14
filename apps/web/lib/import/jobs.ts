/**
 * 裏で走っている取り込み（読み取り・反映）の進み具合。
 * rejudge-job.ts と同じく、このモジュールの変数で持つ（サーバーが 1 台のあいだはこれで足りる）。
 * 進み具合は ImportJob.progress にも折々書くので、画面はどちらを見てもよい
 */

interface Running {
  jobId: string;
  phase: "stage" | "apply";
  startedAt: string;
}

const running = new Map<string, Running>();

export function isRunning(jobId: string): boolean {
  return running.has(jobId);
}

export function anyRunning(): Running | null {
  const first = running.values().next();
  return first.done ? null : first.value;
}

export function markRunning(jobId: string, phase: Running["phase"]): boolean {
  if (running.has(jobId)) return false;
  running.set(jobId, { jobId, phase, startedAt: new Date().toISOString() });
  return true;
}

export function markDone(jobId: string): void {
  running.delete(jobId);
}
