"use client";

import { useEffect, useState } from "react";
import type { PermissionGroupOptionsDto } from "@/lib/types";

/** 人の画面で管理グループを選ぶための一覧（管理者専用の API なので使うのは管理画面だけ） */
export function usePermissionGroupOptions(enabled = true): PermissionGroupOptionsDto | null {
  const [data, setData] = useState<PermissionGroupOptionsDto | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      const res = await fetch("/api/admin/permission-groups/options");
      if (!res.ok) return;
      const body = (await res.json()) as PermissionGroupOptionsDto;
      if (alive) setData(body);
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);
  return data;
}
