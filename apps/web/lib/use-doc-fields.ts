"use client";

import { useEffect, useState } from "react";

/**
 * テンプレートで選べる、会社の自由項目の名前。
 * 項目名は会社ごとに決まるので、静的な一覧には入れられない。
 */
export function useOrgItemLabels(): string[] {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/doc-fields").catch(() => null);
      if (!res?.ok) return;
      const body = (await res.json()) as { orgItems: string[] };
      if (alive) setItems(body.orgItems);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return items;
}
