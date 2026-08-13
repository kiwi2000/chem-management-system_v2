import { getServerMessages } from "@/lib/i18n";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * 権限が無い人に見せる画面。
 * サーバー側で権限を確認したうえで、そもそも中身を描画しないために使う
 * （API が 403 を返すだけだと、空の一覧が「読み込み中」で止まって見える）。
 */
export async function ForbiddenNotice() {
  const m = await getServerMessages();
  return (
    <div className="mx-auto max-w-2xl p-6">
      <Alert variant="destructive">
        <AlertDescription>{m.errors.forbidden}</AlertDescription>
      </Alert>
    </div>
  );
}
