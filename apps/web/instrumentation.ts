/**
 * Next.js の起動時の入口。Node.js の側でだけ、サーバーの見回り（lib/maintenance-timer.ts）を起こす。
 * ここで DB や重いモジュールを読まない（読むのは見回りの中で、しかも遅らせて）
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMaintenanceTimer } = await import("@/lib/maintenance-timer");
  startMaintenanceTimer();
}
