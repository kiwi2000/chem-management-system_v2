"use client";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n-client";

/**
 * 「編集中」の印。**システム全体で同じ見た目**（2026-09-22 指示）。
 * 文字は印の既定のまま、余白を少し広げて枠線を付ける（枠線の色は globals.css の .editing-badge）
 */
export function EditingBadge() {
  const { m } = useI18n();
  return (
    <Badge variant="secondary" className="editing-badge h-6 px-3">
      {m.common.editMode}
    </Badge>
  );
}
