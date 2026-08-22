"use client";

import { Clock } from "lucide-react";
import { useIdleCountdown } from "@/components/idle-logout";
import { useI18n } from "@/lib/i18n-client";
import { cn } from "@/lib/utils";

/**
 * 自動ログアウトまでの残り時間。
 * 出るのは残りが少なくなったときだけで、ふだんは何も出さない。
 * 数字だけを置き、説明はマウスを乗せたときに出す（ツールバーは狭い）。
 */
export function IdleCountdown() {
  const { m } = useI18n();
  const { remainMs, alarm } = useIdleCountdown();
  if (remainMs === null) return null;

  const total = Math.ceil(remainMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return (
    <span
      title={
        minutes > 0
          ? m.shell.idleRemainMinutes(minutes, seconds)
          : m.shell.idleRemainSeconds(seconds)
      }
      aria-label={
        minutes > 0
          ? m.shell.idleRemainMinutes(minutes, seconds)
          : m.shell.idleRemainSeconds(seconds)
      }
      className={cn(
        "inline-flex items-center gap-1 text-sm tabular-nums",
        // 残りわずかになったら、視界の端でも気づけるように背景を付ける
        alarm ? "rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-900" : "opacity-75",
      )}
    >
      <Clock className="size-4" />
      {minutes}:{String(seconds).padStart(2, "0")}
    </span>
  );
}
