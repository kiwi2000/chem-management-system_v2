"use client";

import type { Permission } from "@chem/shared";
import { useEffect, useState } from "react";
import type { MeDto } from "@/lib/types";

/**
 * ログイン中ユーザーの情報（画面の出し分け用）。
 * 認可の判断はサーバー側で必ず行う。ここは「見せるかどうか」だけに使う。
 */
export function useMe(): { me: MeDto | null; can: (p: Permission) => boolean } {
  const [me, setMe] = useState<MeDto | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/me");
      if (res.ok) setMe((await res.json()) as MeDto);
    })();
  }, []);

  return { me, can: (p) => me?.permissions.includes(p) ?? false };
}
