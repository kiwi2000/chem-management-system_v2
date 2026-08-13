"use client";

import { useEffect, useState } from "react";
import { SubstanceForm } from "@/components/substance-form";
import { useI18n } from "@/lib/i18n-client";
import type { PropertyDefDto } from "@/lib/types";
import { useMe } from "@/lib/use-me";

export default function NewSubstancePage() {
  const { m } = useI18n();
  const { me, can } = useMe();
  const [defs, setDefs] = useState<PropertyDefDto[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/substance-property-defs");
      setDefs(res.ok ? ((await res.json()) as { items: PropertyDefDto[] }).items : []);
    })();
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{m.substances.newTitle}</h1>
      {defs === null || me === null ? (
        <p className="text-muted-foreground">{m.common.loading}</p>
      ) : (
        <SubstanceForm defs={defs} readOnly={!can("SUBSTANCE_EDIT")} />
      )}
    </div>
  );
}
