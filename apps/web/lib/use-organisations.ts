"use client";

import { useEffect, useState } from "react";
import type { ListResponse, OrganisationDto } from "@/lib/types";

/**
 * 組織の一覧をまとめて読む。
 * 会社は多くても数件なので、1回で全部読む。管理者専用APIなので使うのは管理画面だけ。
 */
export function useOrganisations(): OrganisationDto[] | null {
  const [items, setItems] = useState<OrganisationDto[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/organisations?size=200");
      if (!res.ok) return;
      const body = (await res.json()) as ListResponse<OrganisationDto>;
      if (alive) setItems(body.items);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return items;
}
