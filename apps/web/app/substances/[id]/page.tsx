"use client";

import { DEFAULT_SETTINGS, type AppSettings } from "@chem/shared";
import { use, useEffect, useState } from "react";
import { SubstanceForm } from "@/components/substance-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useI18n } from "@/lib/i18n-client";
import type { ApiError, PropertyDefDto, SubstanceDetailDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";

export default function EditSubstancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { m } = useI18n();
  const { me, can } = useMe();
  const [item, setItem] = useState<SubstanceDetailDto | null>(null);
  const [defs, setDefs] = useState<PropertyDefDto[] | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [sRes, dRes, cRes] = await Promise.all([
        fetch(`/api/substances/${id}`),
        // 入力済みの値が消えて見えないよう、使わなくなった項目も含めて取得する
        fetch("/api/substance-property-defs?includeInactive=true"),
        fetch("/api/settings"),
      ]);
      if (!sRes.ok) {
        const body = (await sRes.json().catch(() => null)) as ApiError | null;
        setError(body?.error.message ?? m.errors.loadFailed(sRes.status));
        return;
      }
      setItem(((await sRes.json()) as { item: SubstanceDetailDto }).item);
      setDefs(dRes.ok ? ((await dRes.json()) as { items: PropertyDefDto[] }).items : []);
      setSettings(
        cRes.ok
          ? ((await cRes.json()) as { settings: AppSettings }).settings
          : { ...DEFAULT_SETTINGS },
      );
    })();
  }, [id, m]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">
        {can("SUBSTANCE_EDIT") ? m.substances.editTitle : m.substances.title}
      </h1>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!error && (item === null || defs === null || settings === null || me === null) && (
        <p className="text-muted-foreground">{m.common.loading}</p>
      )}
      {item && defs && settings && me && (
        <SubstanceForm
          initial={item}
          defs={defs}
          settings={settings}
          readOnly={!can("SUBSTANCE_EDIT")}
        />
      )}
    </div>
  );
}
