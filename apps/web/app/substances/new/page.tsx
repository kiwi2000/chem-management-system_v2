"use client";

import { DEFAULT_SETTINGS, type AppSettings } from "@chem/shared";
import { useEffect, useState } from "react";
import { SubstanceForm } from "@/components/substance-form";
import { useI18n } from "@/lib/i18n-client";
import type { PropertyDefDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";

export default function NewSubstancePage() {
  const { m } = useI18n();
  const { me, can } = useMe();
  const [defs, setDefs] = useState<PropertyDefDto[] | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void (async () => {
      const [dRes, sRes] = await Promise.all([
        fetch("/api/substance-property-defs"),
        fetch("/api/settings"),
      ]);
      setDefs(dRes.ok ? ((await dRes.json()) as { items: PropertyDefDto[] }).items : []);
      setSettings(
        sRes.ok
          ? ((await sRes.json()) as { settings: AppSettings }).settings
          : { ...DEFAULT_SETTINGS },
      );
    })();
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.substances.newTitle}</h1>
      {defs === null || settings === null || me === null ? (
        <p className="text-muted-foreground">{m.common.loading}</p>
      ) : (
        <SubstanceForm defs={defs} settings={settings} readOnly={!can("SUBSTANCE_EDIT")} />
      )}
    </div>
  );
}
