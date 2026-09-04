import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * GET /api/maintenance — メンテナンス中かどうか。
 *
 * ログイン画面が「いまは管理者しか入れません」と先に知らせるために使う。
 * **認証を通さないルート**（`authz-coverage.test.ts` の allowlist に入っている）。
 * ログインしていない人が呼ぶためのもので、返すのは入・切の1つだけ。
 * 他の設定値は一切返さない（設定は管理者だけが見るもの）
 */
export async function GET() {
  const { maintenanceMode } = await getAppSettings();
  return Response.json({ on: maintenanceMode });
}
