import { Check, Minus } from "lucide-react";

/**
 * 有効 / 無効をアイコン1文字分で出す。
 * 一覧の状態列は横幅を取りたくないので、文字ではなく記号で示す。
 * 色だけで区別すると分からない人がいるため、形（チェック / 横線）も変えている。
 */
export function StatusIcon({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  const label = active ? activeLabel : inactiveLabel;
  return (
    <span title={label} aria-label={label} role="img" className="inline-flex">
      {active ? (
        <Check className="size-4 text-green-600 dark:text-green-400" aria-hidden />
      ) : (
        <Minus className="size-4 text-red-600 dark:text-red-400" aria-hidden />
      )}
    </span>
  );
}
