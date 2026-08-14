"use client";

import { useEffect, useState } from "react";
import type { GroupDto, ListResponse } from "@/lib/types";

/**
 * グループの一覧をまとめて読む（用途での絞り込みは呼び出し側でやる）。
 * グループは多くても数十件なので、用途ごとに分けて2回読むより1回で済ませる。
 * 管理者専用APIなので、使うのは管理画面だけ。
 */
export function useGroups(): GroupDto[] | null {
  const [groups, setGroups] = useState<GroupDto[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/admin/groups?size=200");
      if (!res.ok) return;
      const body = (await res.json()) as ListResponse<GroupDto>;
      if (alive) setGroups(body.items);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return groups;
}
