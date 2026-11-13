"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ListResponse, OrganisationDto } from "@/lib/types";

/**
 * 組織を全部読む（選択肢・上の組織の道筋に使う）。読み直しもできる。
 *
 * **同じ画面で組織を書き換える所は、保存・削除のたびに `reload` を呼ぶ。**
 * 開いたときに 1 回読んだきりにすると、あとから足した組織が「上の組織」の選択肢に出ず、
 * 名称や上の組織を変えても選択肢と道筋が古いままになる（2026-11-13、組織の画面で起きた）。
 *
 * 件数では区切らない（`all=1`）。組織は多くても数百で、区切ると超えた分が黙って選択肢から消える
 */
export function useOrganisationList(): {
  items: OrganisationDto[] | null;
  reload: () => Promise<void>;
} {
  const [items, setItems] = useState<OrganisationDto[] | null>(null);
  /** 続けて読み直したとき、あとから頼んだほうの結果だけを使う。画面を離れたあとの結果も捨てる */
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    const res = await fetch("/api/organisations?all=1");
    if (!res.ok) return;
    const body = (await res.json()) as ListResponse<OrganisationDto>;
    if (mine === latest.current) setItems(body.items);
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      latest.current += 1;
    };
  }, [reload]);

  return { items, reload };
}

/** 組織を全部読む（読むだけの画面用。その画面で組織を書き換えるなら `useOrganisationList`） */
export function useOrganisations(): OrganisationDto[] | null {
  return useOrganisationList().items;
}
