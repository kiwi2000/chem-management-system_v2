"use client";

import { use, useEffect, useState } from "react";
import { PrtrGroupForm } from "@/components/prtr-group-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { redirectIfUnauthorized } from "@/lib/auth-redirect";
import { useI18n } from "@/lib/i18n-client";
import { PAGE_SHELL_STACKED } from "@/lib/page-shell";
import type { ApiError, PrtrGroupDto } from "@/lib/types";

/** グループの詳細（S22-1）。まず読み取り専用、「編集」で書き換え可 */
export default function PrtrGroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { m } = useI18n();
  const [item, setItem] = useState<PrtrGroupDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/prtr/groups/${id}`).catch(() => null);
      if (!res?.ok) {
        if (res) {
          if (redirectIfUnauthorized(res)) return;
          const body = (await res.json().catch(() => null)) as ApiError | null;
          setError(body?.error.message ?? m.errors.loadFailed(res.status));
        }
        return;
      }
      setItem(((await res.json()) as { item: PrtrGroupDto }).item);
    })();
  }, [id, m]);

  return (
    <div className={PAGE_SHELL_STACKED}>
      <h1 className="text-2xl font-semibold">
        {m.prtr.groups.title}
        {item && (
          <span className="text-muted-foreground ml-3 font-mono text-base font-normal">
            {item.code}
          </span>
        )}
      </h1>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!error && !item && <p className="text-muted-foreground text-sm">{m.common.loading}</p>}
      {item && <PrtrGroupForm key={item.updatedAt} initial={item} />}
    </div>
  );
}
