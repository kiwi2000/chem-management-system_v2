"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n-client";
import type { StaleEditInfo } from "@/lib/stale-edit";

/**
 * ほかの人が先に保存していたときの知らせ（楽観的ロック）。
 *
 * **保存は止めていない。**入力はそのまま残っているので、
 * 見たうえで「このまま保存する」（force を付けて送り直す）か、閉じて直し続けるかを選べる。
 * `onReload` を渡せば「読み直す」（入力を捨てて最新を読む）も出す
 */
export function StaleEditNotice({
  stale,
  saving,
  onForce,
  onDismiss,
  onReload,
}: {
  stale: StaleEditInfo | null;
  saving?: boolean;
  onForce: () => void;
  onDismiss: () => void;
  onReload?: () => void;
}) {
  const { m, locale } = useI18n();
  if (!stale) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription className="space-y-2">
        <p className="font-medium">{m.errors.staleEdit}</p>
        <p>
          {m.errors.staleEditDetail(
            stale.byName ?? m.errors.staleEditSomeone,
            stale.at ? new Date(stale.at).toLocaleString(locale) : "-",
          )}
        </p>
        <p>{m.errors.staleEditAsk}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" size="sm" disabled={saving} onClick={onForce}>
            {m.errors.staleEditSave}
          </Button>
          {onReload && (
            <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onReload}>
              {m.errors.staleEditReload}
            </Button>
          )}
          {/* 押しても閉じるだけ。入力はそのまま残る */}
          <Button type="button" size="sm" variant="outline" onClick={onDismiss}>
            {m.common.cancel}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
