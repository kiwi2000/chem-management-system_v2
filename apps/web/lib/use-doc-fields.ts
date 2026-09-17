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

/** 表のブロックで選ぶ規制区分。名前は元の言語・日本語・英語を持ち、画面の側でテンプレートの言語に合わせる */
export interface DocCategoryOption {
  id: string;
  lawId: string;
  nameOriginal: string;
  nameJa: string | null;
  nameEn: string | null;
  law: { nameOriginal: string; nameJa: string | null; nameEn: string | null };
}

/** 表のブロックは何個もあるので、一覧は 1 回だけ引いて使い回す */
let categoriesCache: Promise<DocCategoryOption[]> | null = null;

export function useDocCategories(): DocCategoryOption[] {
  const [items, setItems] = useState<DocCategoryOption[]>([]);
  useEffect(() => {
    let alive = true;
    categoriesCache ??= fetch("/api/doc-fields")
      .then((res) => (res.ok ? res.json() : { categories: [] }))
      .then((body: { categories?: DocCategoryOption[] }) => body.categories ?? [])
      .catch(() => []);
    void categoriesCache.then((list) => {
      if (alive) setItems(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  return items;
}
