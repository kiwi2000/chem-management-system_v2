"use client";

import { use, useEffect, useState } from "react";
import { NewsForm } from "@/components/news-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, NewsDto } from "@/lib/types";

export default function EditNewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { m } = useI18n();
  const [item, setItem] = useState<NewsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/news/${id}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(res.status));
        return;
      }
      setItem(((await res.json()) as { item: NewsDto }).item);
    })();
  }, [id, m]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.news.editTitle}</h1>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!error && !item && <p className="text-muted-foreground">{m.common.loading}</p>}
      {item && <NewsForm initial={item} />}
    </div>
  );
}
