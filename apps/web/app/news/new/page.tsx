"use client";

import { NewsForm } from "@/components/news-form";
import { useI18n } from "@/lib/i18n-client";

export default function NewNewsPage() {
  const { m } = useI18n();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.news.newTitle}</h1>
      <NewsForm canEdit />
    </div>
  );
}
