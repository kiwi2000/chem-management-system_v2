"use client";

import { useEffect, useState } from "react";
import type { OwnerChoicesDto } from "@/lib/types";

/** 作る・移す・取り込むときに選べる所属先（S31）。製品・原材料か物質か */
export function useOwnerChoices(
  target: "product" | "substance",
  enabled = true,
  /** edit = 作る・移すときの選択肢、view = 一覧の絞り込みの選択肢 */
  use: "edit" | "view" = "edit",
) {
  const [data, setData] = useState<OwnerChoicesDto | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      const res = await fetch(
        `/api/owner-groups?for=${target}${use === "view" ? "&use=view" : ""}`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as OwnerChoicesDto;
      if (alive) setData(body);
    })();
    return () => {
      alive = false;
    };
  }, [target, enabled, use]);
  return data;
}
